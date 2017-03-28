import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

admin.initializeApp(functions.config().firebase);

//noinspection JSUnusedGlobalSymbols
export const slackOAuth = functions.https.onRequest((request, response) => {
    response.status(200).send("Aye!");
    return;
});