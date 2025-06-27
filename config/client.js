const { Client, LocalAuth } = require("whatsapp-web.js");

const client = new Client({
    puppeteer: { headless: true, args: ["--no-sandbox"] },
    authStrategy: new LocalAuth({ clientId: "bot-el-arepazo" }),
    webVersionCache: {
        type: "remote",
        remotePath:
            "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2411.2.html",
    },
    authTimeoutMs: 60000,
    qrTimeout: 30000,
});

module.exports = { client };