import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as rp from "request-promise";

admin.initializeApp(functions.config().firebase);

//noinspection JSUnusedGlobalSymbols
export const oauth_redirect = functions.https.onRequest(async (request, response) => {

    if (!request.query && !request.query.code) {
        response.status(401).send("Missing query attribute 'code'");
        return;
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
        response.header("Location", `https://${process.env.GCLOUD_PROJECT}.firebaseapp.com`).send(302);
        return;
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