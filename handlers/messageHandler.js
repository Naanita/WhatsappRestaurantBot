const { client } = require("../config/client");
const conversation = require("../utils/conversation");
const stateHandlers = require("./stateHandlers");
const { sendWelcomeImage } = require("../utils/helpers");

async function messageHandler(msg) {
    const from = msg.from;
    const body = msg.body.trim();

    if (!conversation.getConversationState(from)) {
        conversation.resetConversation(from);
        conversation.setConversationState(from, "inicio");
        await sendWelcomeImage(from, client);
        await client.sendMessage(
            from,
            "¡Hola! 👋 Bienvenido a *El Arepazo* 🫓.\nEstoy aquí para ayudarte. ¿Qué te gustaría hacer hoy?\n\n" +
            "*1.* Hacer un pedido 🫓\n*2.* Ver nuestra ubicación 📍 \n*3.* Consultar el estado de mi pedido 🚚"
        );
        return;
    }

    try {
        const state = conversation.getConversationState(from);
        if (stateHandlers[state]) {
            await stateHandlers[state](from, body, client);
        } else {
            console.error(`Unhandled state: ${state}`);
            await client.sendMessage(from, "Lo siento, ha ocurrido un error. Por favor, intenta de nuevo.");
            conversation.resetConversation(from);
        }
    } catch (error) {
        console.error("Error en el flujo:", error);
        await client.sendMessage(
            from,
            "Ocurrió un error inesperado. Intenta de nuevo más tarde o contacta al administrador."
        );
        conversation.resetConversation(from);
    }
}

module.exports = messageHandler;