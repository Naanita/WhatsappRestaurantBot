require("dotenv").config();
const { client } = require("./config/client");
const messageHandler = require("./handlers/messageHandler");
const qrcode = require("qrcode-terminal");

client.on("qr", (qr) => qrcode.generate(qr, { small: true }));
client.on("ready", () => console.log("Client is ready!"));
client.on("authenticated", () => console.log("Client is authenticated!"));
client.on("auth_failure", (msg) => console.error("Authentication failure", msg));

client.on("message", messageHandler);

client
  .initialize()
  .then(() => console.log("Client initialized successfully"))
  .catch((err) => console.error("Error initializing client", err));