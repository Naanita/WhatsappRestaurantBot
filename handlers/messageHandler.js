const { client } = require("../config/client");
const conversation = require("../utils/conversation");
const stateHandlers = require("./stateHandlers");
const { sendWelcomeImage } = require("../utils/helpers");
const adminService = require("../services/adminService");

async function messageHandler(msg) {
    const from = msg.from;
    const body = msg.body.trim();

    // --- Lógica para manejar la respuesta del Admin ---
    if (from === process.env.ADMIN_WHATSAPP_NUMBER) {
        const verificationIdMatch = body.match(/ID de Verificación: (\w+)/);
        if (verificationIdMatch) {
            // No hacer nada si es el mensaje que el bot envía al admin
            return;
        }

        const lastPending = await adminService.getLastPendingVerification();
        if (lastPending && (body === '1' || body === '2')) {
            const decision = body === '1' ? 'Confirmado' : 'Denegado';
            await adminService.updateVerificationStatus(lastPending.id, decision);

            const clientNumber = lastPending.clientNumber;
            const userData = conversation.getUserData(clientNumber);

            if (decision === 'Confirmado') {
                await client.sendMessage(clientNumber, "✅ Pago recibido correctamente. Tu trámite avanza a la siguiente etapa. ¿Deseas algo más?");
                await stateHandlers.handleConfirmacion(clientNumber, client);
                conversation.resetConversation(clientNumber);
            } else {
                userData.denialCount = (userData.denialCount || 0) + 1;
                if (userData.denialCount >= 2) {
                    await client.sendMessage(clientNumber, "❌ Tu pago ha sido denegado nuevamente. Un agente se pondrá en contacto contigo.");
                    // Lógica para escalar a un agente
                } else {
                    conversation.setConversationState(clientNumber, "pago_denegado");
                    await client.sendMessage(clientNumber, "❌ Pago no reconocido. Por favor revisa tu comprobante o contáctanos por otro medio. ¿Quieres intentarlo de nuevo?\n\n1. Reenviar comprobante\n2. Volver al menú principal\n3. Hablar con un agente");
                }
            }
            return; // Detiene el flujo normal para el admin
        }
    }


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
        const handler = stateHandlers[state];

        if (handler) {
            // El handler de `nequi_envio_comprobante` necesita el objeto `msg` completo para la media
            if (state === 'nequi_envio_comprobante') {
                await handler(from, msg, client);
            } else {
                await handler(from, body, client);
            }
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