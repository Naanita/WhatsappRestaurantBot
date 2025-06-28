// handlers/messageHandler.js

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

/**
 * Función de utilidad para crear un retardo (delay).
 * @param {number} ms - Milisegundos a esperar.
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Envía un mensaje simulando que el bot está escribiendo y con un retardo.
 * @param {string} chatId - ID del chat al que se enviará el mensaje.
 * @param {string|MessageMedia} content - Contenido del mensaje.
 * @param {object} options - Opciones adicionales para el mensaje.
 */
async function sendMessageWithTyping(chatId, content, options = {}) {
    if (!isClientReady) {
        console.error(`WhatsApp client is not ready. Aborted sending message to ${chatId}.`);
        return;
    }
    
    try {
        const chat = await client.getChatById(chatId);
        await chat.sendStateTyping();

        const typingDelay = typeof content === 'string' ? content.length * 60 : 1500;
        await delay(Math.min(typingDelay, 1000)); // Esperar un tiempo realista, máximo 1 segundo.

        await chat.sendMessage(content, options);
    } catch (err) {
        console.error(`Error in sendMessageWithTyping to ${chatId}:`, err);
    }
}

/**
 * Manejador principal de mensajes entrantes.
 */
async function messageHandler(msg) {
    const from = msg.from;
    const body = msg.body ? msg.body.trim() : "";

    // Detener temporizadores pendientes porque el usuario ha respondido.
    conversation.clearInactivityTimer(from);

    try {
        // --- Lógica del Admin ---
        if (from === process.env.ADMIN_WHATSAPP_NUMBER) {
            const lastPending = await adminService.getLastPendingVerification();
            if (lastPending && (body === '1' || body === '2')) {
                const decision = body === '1' ? 'Confirmado' : 'Denegado';
                await adminService.updateVerificationStatus(lastPending.id, decision);
                const clientNumber = lastPending.clientNumber;
                
                if (decision === 'Confirmado') {
                    await sendMessageWithTyping(clientNumber, "✅ ¡Tu pago ha sido confirmado por el administrador!");
                    await stateHandlers.confirmacion(clientNumber, client);
                } else {
                    const userData = conversation.getUserData(clientNumber);
                    userData.denialCount = (userData.denialCount || 0) + 1;
                    conversation.setConversationState(clientNumber, "pago_denegado");
                    if (userData.denialCount >= 2) {
                        await sendMessageWithTyping(clientNumber, "❌ Tu pago ha sido denegado nuevamente. Un agente se pondrá en contacto contigo para ayudarte.");
                    } else {
                        await sendMessageWithTyping(clientNumber, "❌ El pago no pudo ser reconocido. ¿Quieres intentarlo de nuevo?\n\n1. Reenviar comprobante\n2. Volver al menú principal\n3. Hablar con un agente");
                    }
                }
                return; 
            }
        }
        
        const state = conversation.getConversationState(from);

        if (!state || body.toLowerCase() === 'cancelar' || body.toLowerCase() === 'menu') {
            conversation.resetConversation(from);
            conversation.setConversationState(from, "inicio");
            await sendWelcomeImage(from, client);
            await sendMessageWithTyping(
                from,
                "¡Hola! 👋 Bienvenido a *El Arepazo* 🫓.\nEstoy aquí para ayudarte. ¿Qué te gustaría hacer hoy?\n\n" +
                "*1.* Hacer un pedido 🫓\n*2.* Ver nuestra ubicación 📍 \n*3.* Consultar el estado de mi pedido 🚚"
            );
            conversation.startInactivityTimer(from, client); // Iniciar temporizador
            return;
        }

        const handler = stateHandlers[state];

        if (handler) {
            // Pasamos nuestra nueva función de envío a los handlers
            const customClient = { ...client, sendMessage: (id, content, options) => sendMessageWithTyping(id, content, options) };
            
            if (state === 'nequi_envio_comprobante') {
                await handler(from, msg, customClient);
            } else {
                await handler(from, body, customClient);
            }

            // Después de que un handler se ejecute, reiniciamos el temporizador
            // solo si la conversación no ha terminado.
            const currentState = conversation.getConversationState(from);
            if (currentState) {
                conversation.startInactivityTimer(from, client);
            }

        } else {
            console.error(`Unhandled state: ${state} for user ${from}`);
            await sendMessageWithTyping(from, "Lo siento, ha ocurrido un error. Te he regresado al menú principal.");
            conversation.resetConversation(from);
        }

    } catch (error) {
        console.error(`Error in message flow for ${from} in state ${conversation.getConversationState(from)}:`, error);
        await sendMessageWithTyping(
            from,
            "¡Ups! Algo salió mal de nuestro lado. Por favor, intenta de nuevo. Si el problema persiste, contacta al administrador."
        );
        conversation.resetConversation(from);
    }
}

module.exports = messageHandler;