// /bot.js

require("dotenv").config();
const { client } = require("./config/client");
const messageHandler = require("./handlers/messageHandler");
const qrcode = require("qrcode-terminal");

// --- MANEJO DE ERRORES GLOBAL ---
// Atrapa errores que no fueron capturados en ninguna parte del código
process.on('uncaughtException', (err, origin) => {
  console.error(`An uncaught exception occurred: ${err.message}`);
  console.error(`Exception origin: ${origin}`);
  console.error(err.stack);
});

// Atrapa promesas que fueron rechazadas y no tienen un .catch()
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
});

client.on("qr", (qr) => {
    console.log("QR RECEIVED", qr);
    qrcode.generate(qr, { small: true });
});

client.on("ready", () => console.log("Client is ready!"));
client.on("authenticated", () => console.log("Client is authenticated!"));
client.on("auth_failure", (msg) => console.error("Authentication failure", msg));

// Añadimos un listener para los errores de desconexión
client.on('disconnected', (reason) => {
    console.log('Client was logged out', reason);
});

client.on("message", messageHandler);


// --- INICIALIZACIÓN CON TRY-CATCH ---
async function startBot() {
    try {
        console.log("Initializing client...");
        await client.initialize();
        console.log("Client initialized successfully");
    } catch (err) {
        console.error("Error during client initialization:", err);
    }
}

startBot();