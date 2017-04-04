import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as rp from "request-promise";

admin.initializeApp(functions.config().firebase);

const SLACK_ACTION_REQUEST_PING = "ping-pong";

// ---------------------------------------------------------------------------------------------------------------------
//region API ENDPOINT TRIGGERS
//

//noinspection JSUnusedGlobalSymbols
export const oauth_redirect = functions.https.onRequest(async (request, response) => {
    if (request.method !== "GET") {
        console.error(`Got unsupported ${request.method} request. Expected GET.`);
        return response.send(405, "Only GET requests are accepted");
    }

    if (!request.query && !request.query.code) {
        return response.status(401).send("Missing query attribute 'code'");
    }

    const options = {
        uri: "https://slack.com/api/oauth.access",
        method: "GET",
        json: true,
        qs: {
            code: request.query.code,
            client_id: functions.config().slack.id,
            client_secret: functions.config().slack.secret,
            redirect_uri: `https://us-central1-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/oauth_redirect`
        }
    };

    const result = await rp(options) as SlackOAuthResponse;
    if (!result.ok) {
        console.error("The request was not ok: " + JSON.stringify(result));
        return response.header("Location", `https://${process.env.GCLOUD_PROJECT}.firebaseapp.com`).send(302);
    }

    await admin.database().ref("installations").child(result.team_id).set({
        token: result.access_token,
        team: result.team_id,
        webhook: {
            url: result.incoming_webhook.url,
            channel: result.incoming_webhook.channel_id
        }
    });

    response.header("Location", `https://${process.env.GCLOUD_PROJECT}.firebaseapp.com/success.html`).send(302);
});

//noinspection JSUnusedGlobalSymbols
export const command_ping = functions.https.onRequest(async (request, response) => {
    if (request.method !== "POST") {
        console.error(`Got unsupported ${request.method} request. Expected POST.`);
        return response.send(405, "Only POST requests are accepted");
    }

    const command = request.body as SlackSlashCommand;
    if (command.token !== functions.config().slack.token) {
        console.error(`Invalid request token ${command.token} from ${command.team_id} (${command.team_domain}.slack.com)`);
        return response.send(401, "Invalid request token!");
    }

    // Handle the commands later, Slack expect this request to return within 3000ms
    await admin.database().ref("commands/ping").push(command);

    return response.contentType("json").status(200).send({
        "response_type": "ephemeral",
        "text": "Pinging team..."
    });
});

//noinspection JSUnusedGlobalSymbols
export const message_action = functions.https.onRequest(async (request, response) => {
    if (request.method !== "POST") {
        console.error(`Got unsupported ${request.method} request. Expected POST.`);
        return response.send(405, "Only POST requests are accepted");
    }

    if (!request.body && request.body.payload) {
        return response.send(401, "Bad formatted action response");
    }

    const action = JSON.parse(request.body.payload) as SlackActionInvocation;

    if (action.callback_id !== SLACK_ACTION_REQUEST_PING) {
        return response.send(405, "Only ping pong actions are implemented!");
    }

    // Handle the actions later, Slack expect this request to return within 3000ms
    await admin.database().ref("actions").push(action);

    // Update the buttons to try and limit the amount of player inputs
    if (action.actions[0].name.startsWith("1")) {
        action.original_message.attachments[0].actions[0].style = "primary";
        action.original_message.attachments[0].actions[0].name = "2.pong";
    } else if (action.actions[0].name.startsWith("2")) {
        action.original_message.attachments[0].actions[0].style = "danger";
        action.original_message.attachments[0].actions[0].name = "3.pong";
    } else {
        action.original_message.text = `The current game of PING (id ${action.actions[0].value}) is over!`;
        action.original_message.attachments[0].actions = [];
    }

    return response.contentType("json").status(200).send(action.original_message);
});

//endregion API ENDPOINT TRIGGERS


// ---------------------------------------------------------------------------------------------------------------------
//region DATABASE TRIGGERS
//


//noinspection JSUnusedGlobalSymbols
export const on_command_ping = functions.database.ref("commands/ping/{id}").onWrite(async (event) => {
    if (!event.data.exists()) {
        return "Nothing to do for deletion of processed commands.";
    }

    // Start by deleting the command itself from the queue
    await event.data.ref.remove();

    const command = event.data.val() as SlackSlashCommand;

    const installationRef = admin.database().ref("installations").child(command.team_id);
    const installation = (await installationRef.once("value")).val() as InstallationData;

    const options = {
        uri: installation.webhook.url,
        method: "POST",
        json: true,
        body: {
            text: `You are challenged to a game of PING! (id: ${event.params.id})`,
            attachments: [
                {
                    fallback: "No ping pong for you today",
                    callback_id: SLACK_ACTION_REQUEST_PING,
                    attachment_type: "default",
                    actions: [
                        {
                            name: "1.pong",
                            text: "Pong!",
                            type: "button",
                            value: event.params.id
                        }
                    ]
                }
            ]
        }
    };

    const ping: Ping = {
        pinged_at: admin.database.ServerValue.TIMESTAMP,
        team: command.team_id,
        user: command.user_id
    };

    await admin.database().ref("ping").child(event.params.id).set(ping);
    return rp(options);
});

//noinspection JSUnusedGlobalSymbols
export const on_actions = functions.database.ref("actions/{id}").onWrite(async (event) => {
    if (!event.data.exists()) {
        return "Nothing to do for deletion of processed commands.";
    }

    // Start by deleting the action request itself from the queue
    await event.data.ref.remove();

    const action = event.data.val() as SlackActionInvocation;

    if (action.callback_id !== SLACK_ACTION_REQUEST_PING) {
        console.error("Only ping pong actions are implemented!");
        return;
    }

    const pongId = admin.database().ref("pong").push().key;
    const pingId = action.actions[0].value;
    const pingRef = admin.database().ref("ping").child(pingId);
    const transactionResult = await pingRef.transaction((ping) => {
        if (!ping) {
            return null;
        }

        if (ping.pongs && Object.keys(ping.pongs).length >= 3) {
            // Only count the first three pings!
            console.log(`User ${action.user.name}@${action.team.domain} was too late to reply to ping ${pingId}`);
            return;
        }

        ping.pongs = ping.pongs || {};
        // Slack timestamps comes as Unix Epoch in SECONDS with milliseconds in fraction
        ping.pongs[pongId] = Math.round(parseFloat(action.action_ts) * 1000);
        return ping;
    });

    const committed = transactionResult.committed;
    const ping = transactionResult.snapshot.exists() ? transactionResult.snapshot.val() as Ping : null;
    if (!committed) {
        return "Not your luck today";
    }

    const pongTime = ping.pongs[pongId];
    const pong: Pong = {
        ponged_at: pongTime,
        ping_pong_time: pongTime - ping.pinged_at,
        user_id: action.user.id,
        user_name: action.user.name,
        team: action.team.id,
        ping: pingId
    };

    await admin.database().ref("pong").child(pongId).set(pong);

    const numberOfPongs = Object.keys(ping.pongs).length;
    if (numberOfPongs < 3) {
        return "Waiting for more pongs";
    }

    return sendPingPongScore(pingId);
});

//endregion DATABASE TRIGGERS

// ---------------------------------------------------------------------------------------------------------------------
//region INTERNAL FUNCTIONS
//
// Ignore everything below here, it's just definitions for better auto-completion and
// to help remembering the structure of data

async function sendPingPongScore(pingId: string) {
    const payload = {attachments: []};
    const ping = (await admin.database().ref("ping").child(pingId).once("value")).val() as Ping;
    const snap = await admin.database().ref("pong").orderByChild("ping").equalTo(pingId).limitToFirst(3).once("value");

    const medalColors = ["#C98910", "#A8A8A8", "#965A38"];
    let counter = 0;
    snap.forEach((childSnap) => {
        const pong = childSnap.val() as Pong;
        const color = medalColors[counter];
        counter += 1;

        payload.attachments.push({
            "fallback": "No ping pong scores for you today.",
            "color": color,
            "title": `#${counter} <@${pong.user_id}|${pong.user_name}>`,
            "fields": [
                {
                    "title": "Pinged at",
                    "value": (new Date(pong.ponged_at)).toString(),
                    "short": true
                },
                {
                    "title": "Response time",
                    "value": `${pong.ping_pong_time/1000} seconds`,
                    "short": true
                }
            ]
        });

    });


    const installationRef = admin.database().ref("installations").child(ping.team);
    const installation = (await installationRef.once("value")).val() as InstallationData;
    return rp({
        uri: installation.webhook.url,
        method: "POST",
        json: true,
        body: payload
    });
}

//endregion INTERNAL FUNCTIONS


// ---------------------------------------------------------------------------------------------------------------------
//region INTERFACES
//
// Ignore everything below here, it's just definitions for better auto-completion and
// to help remembering the structure of data

interface Pong {
    ponged_at: number,
    ping_pong_time: number,
    team: string,
    user_id: string,
    user_name: string,
    ping: string
}

interface Ping {
    pinged_at: number,
    team: string,
    user: string,
    pongs?: any
}

interface InstallationData {
    team: string,
    token: string,
    webhook: {
        channel: string,
        url: string
    }
}

interface SlackOAuthResponse {
    ok: boolean,
    access_token: string,
    scope: string,
    user_id: string,
    team_name: string,
    team_id: string,
    incoming_webhook: {
        channel: string,
        channel_id: string,
        configuration_url: string,
        url: string
    }
}

interface SlackSlashCommand {
    token: string,
    team_id: string,
    team_domain: string,
    channel_id: string,
    channel_name: string,
    user_id: string,
    user_name: string,
    command: string,
    text: string,
    response_url: string
}

interface SlackAction {
    name: string,
    type: string,
    value: string
}

interface SlackActionInvocation {
    actions: SlackAction[],
    callback_id: string,
    team: { id: string, domain: string },
    channel: { id: string, name: string },
    user: { id: string, name: string },
    action_ts: string,
    message_ts: string,
    attachment_id: string,
    token: string,
    is_app_unfurl: boolean,
    response_url: string,
    original_message: {
        text: string,
        bot_id: string,
        attachments?: any,
        type: string,
        subtype: string,
        ts: string
    }
}
//endregion INTERFACES