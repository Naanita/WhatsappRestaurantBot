const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const creds = require("../credentials.json");

function getServiceAccountAuth() {
    return new JWT({
        email: creds.client_email,
        key: creds.private_key.replace(/\\n/g, "\n"),
        scopes: [
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/drive.file",
        ],
    });
}

async function getGoogleSheet(sheetId) {
    const serviceAccountAuth = getServiceAccountAuth();
    const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
    await doc.loadInfo();
    return doc;
}

module.exports = { getGoogleSheet };