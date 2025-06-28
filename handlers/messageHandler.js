const { client } = require("../config/client");
const conversation = require("../utils/conversation");
const stateHandlers = require("./stateHandlers");
const { sendWelcomeImage } = require("../utils/helpers");
const adminService = require("../services/adminService");

let isClientReady = false;

client.on('ready', () => {
    isClientReady = true;
    console.log('Client is ready!');
});

client.on('disconnected', (reason) => {
    isClientReady = false;
    console.error('Client disconnected:', reason);
});

client.on('auth_failure', (msg) => {
    isClientReady = false;
    console.error('Auth failure:', msg);
});

async function safeSendMessage(chatId, content, options) {
    if (!isClientReady) {
        console.error('WhatsApp client is not ready. Cannot send message.');
        return;
    }
    try {
        await client.sendMessage(chatId, content, options);
    } catch (err) {
        console.error('Error sending message:', err);
    }
}

async function messageHandler(msg) {
    const from = msg.from;
    const body = msg.body.trim();

    // --- Lógica para manejar la respuesta del Admin ---
    if (from === process.env.ADMIN_WHATSAPP_NUMBER) {
        // ... (código existente sin cambios)

        const lastPending = await adminService.getLastPendingVerification();
        if (lastPending && (body === '1' || body === '2')) {
            const decision = body === '1' ? 'Confirmado' : 'Denegado';
            await adminService.updateVerificationStatus(lastPending.id, decision);

            const clientNumber = lastPending.clientNumber;
            const userData = conversation.getUserData(clientNumber);

            if (decision === 'Confirmado') {
                // --- INICIO DE LA CORRECCIÓN ---
                await safeSendMessage(clientNumber, "✅ Pago recibido correctamente.");

                // 2. Se llama a la función con el nombre de exportación correcto ('confirmacion').
                //    Esto enviará el resumen del pedido confirmado al cliente.
                await stateHandlers.confirmacion(clientNumber, client);
                
                // --- FIN DE LA CORRECCIÓN ---

            } else {
                userData.denialCount = (userData.denialCount || 0) + 1;
                if (userData.denialCount >= 2) {
                    await safeSendMessage(clientNumber, "❌ Tu pago ha sido denegado nuevamente. Un agente se pondrá en contacto contigo.");
                    // Lógica para escalar a un agente
                } else {
                    conversation.setConversationState(clientNumber, "pago_denegado");
                    await safeSendMessage(clientNumber, "❌ Pago no reconocido. Por favor revisa tu comprobante o contáctanos por otro medio. ¿Quieres intentarlo de nuevo?\n\n1. Reenviar comprobante\n2. Volver al menú principal\n3. Hablar con un agente");
                }
            }
            return; // Detiene el flujo normal para el admin
        }
    }


    if (!conversation.getConversationState(from)) {
        conversation.resetConversation(from);
        conversation.setConversationState(from, "inicio");
        await sendWelcomeImage(from, client);
        await safeSendMessage(
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
            await safeSendMessage(from, "Lo siento, ha ocurrido un error. Por favor, intenta de nuevo.");
            conversation.resetConversation(from);
        }
    } catch (error) {
        console.error("Error en el flujo:", error);
        await safeSendMessage(
            from,
            "Ocurrió un error inesperado. Intenta de nuevo más tarde o contacta al administrador."
        );
        conversation.resetConversation(from);
    }
}

module.exports = messageHandler;