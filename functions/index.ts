import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as rp from "request-promise";

admin.initializeApp(functions.config().firebase);

const SLACK_ACTION_REQUEST_PING = "ping.pong";
const SLACK_ACTION_RESPONSE_PONG = "pong";

//noinspection JSUnusedGlobalSymbols
export const oauth_redirect = functions.https.onRequest(async (request, response) => {

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

    await admin.database().ref("ping").push({
        team: command.team_id,
        user: command.user_id
    });

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

    const pingId = action.actions[0].value;
    const transactionResult = await admin.database().ref("ping").child(pingId).transaction((ping) => {
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
        ping.pongs[action.user.id] = Math.round(parseFloat(action.action_ts) * 1000);
        return ping;
    });

    const committed = transactionResult.committed;
    const ping = transactionResult.snapshot.exists() ? transactionResult.snapshot.val() as Ping : null;

    if (!committed && !ping) {
        return response.send(404, "There's no PING for Your PONG!?!");
    }

    if (!committed) {
        return response.send(200, "Too late!!! Try to be quicker next time! :-)");
    }

    const pongTime = ping.pongs[action.user.id];
    const pong: Pong = {
        ponged_at: pongTime,
        ping_pong_time: pongTime - ping.pinged_at,
        user: action.user.id,
        team: action.team.id,
        ping: pingId
    };

    await admin.database().ref("pong").push(pong);
    const pongNumber = Object.keys(ping.pongs).length;

    action.original_message.attachments.push({
        "title": "#" + pongNumber,
        "text": `@${action.user.name}`
    });
    return response.contentType("json").status(200).send(action.original_message);
});

//noinspection JSUnusedGlobalSymbols
export const on_ping = functions.database.ref("ping/{id}").onWrite(async (event) => {
    if (!event.data.exists()) {
        return "Nothing to do on delete";
    }

    const ping = event.data.val() as Ping;
    if (ping.pinged_at) {
        return "Nothing to do for further updates.";
    }

    const installationRef = admin.database().ref("installations").child(ping.team);
    const installation = (await installationRef.once("value")).val() as InstallationData;

    const options = {
        uri: installation.webhook.url,
        method: "POST",
        json: true,
        body: {
            text: "PING!!?",
            attachments: [
                {
                    fallback: "No ping pong for you today",
                    callback_id: SLACK_ACTION_REQUEST_PING,
                    attachment_type: "default",
                    actions: [
                        {
                            name: SLACK_ACTION_RESPONSE_PONG,
                            text: "Pong!",
                            type: "button",
                            value: event.params.id
                        }
                    ]
                }
            ]
        }
    };

    // Set the timestamp as close to the notification as possible
    await event.data.ref.parent.child("pinged_at").set(admin.database.ServerValue.TIMESTAMP);
    return rp(options);
});


// ---------------------------------------------------------------------------------------------------------------------
//region INTERFACES
//
// Ignore everything below here, it's just definitions for better auto-completion and
// to help remembering the structure of data

interface Pong {
    ponged_at: number,
    ping_pong_time: number,
    team: string,
    user: string,
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