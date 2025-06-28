// /utils/conversation.js

const conversationStates = {};
const userData = {};

// --- Funciones Principales de Conversación ---

/**
 * Obtiene el estado de conversación actual para un usuario.
 * @param {string} from - El número del usuario.
 * @returns {string|null} - El estado actual o null si no existe.
 */
function getConversationState(from) {
    return conversationStates[from];
}

/**
 * Establece un nuevo estado de conversación para un usuario.
 * @param {string} from - El número del usuario.
 * @param {string} state - El nuevo estado a establecer.
 */
function setConversationState(from, state) {
    conversationStates[from] = state;
}

/**
 * Obtiene los datos de sesión de un usuario (carrito, etc.).
 * @param {string} from - El número del usuario.
 * @returns {object} - Los datos del usuario.
 */
function getUserData(from) {
    if (!userData[from]) {
        userData[from] = {
            cart: [],
            step: "inicio",
            nequiAttempts: 0,
            denialCount: 0
        };
    }
    return userData[from];
}

/**
 * Reinicia la conversación y los datos de un usuario.
 * @param {string} from - El número del usuario.
 */
function resetConversation(from) {
    console.log(`[Conversation] Reiniciando la conversación para ${from}`);
    clearInactivityTimer(from); // Asegurarse de limpiar temporizadores al reiniciar
    conversationStates[from] = null;
    userData[from] = {
        cart: [],
        step: "inicio",
        nequiAttempts: 0,
        denialCount: 0
    };
}

// --- Lógica de Temporizadores de Inactividad ---

/**
 * Detiene y limpia los temporizadores de inactividad de un usuario.
 * @param {string} from - El ID del chat del usuario.
 */
function clearInactivityTimer(from) {
    if (userData[from] && userData[from].inactivityTimers) {
        console.log(`[Timer] Limpiando temporizador de inactividad para ${from}.`);
        clearTimeout(userData[from].inactivityTimers.warning);
        clearTimeout(userData[from].inactivityTimers.end);
        delete userData[from].inactivityTimers;
    }
}

/**
 * Inicia los temporizadores de inactividad para un usuario.
 * @param {string} from - El ID del chat del usuario.
 * @param {object} client - El cliente de whatsapp-web.js para poder enviar mensajes.
 */
function startInactivityTimer(from, client) {
    clearInactivityTimer(from); // Limpia cualquier temporizador antiguo antes de crear nuevos

    console.log(`[Timer] Iniciando temporizadores de inactividad para ${from}`);

    const warningTimer = setTimeout(() => {
        console.log(`[Timer] 45 minutos de inactividad. Enviando recordatorio a ${from}.`);
        client.sendMessage(from, "👋 ¿Sigues ahí? Si no respondes, la conversación se cerrará pronto.");
    }, 45 * 60 * 1000); // 45 minutos

    const endSessionTimer = setTimeout(() => {
        console.log(`[Timer] 90 minutos de inactividad. Finalizando sesión para ${from}.`);
        client.sendMessage(from, "Hemos finalizado esta conversación por inactividad. ¡No dudes en escribir de nuevo cuando quieras empezar un nuevo pedido!");
        // Aquí 'resetConversation' ya está definida y en el alcance correcto.
        resetConversation(from);
    }, 90 * 60 * 1000); // 90 minutos

    // Se asegura de que userData[from] exista antes de asignarle los timers
    if (!userData[from]) {
        userData[from] = {};
    }
    userData[from].inactivityTimers = {
        warning: warningTimer,
        end: endSessionTimer,
    };
}

module.exports = {
    getConversationState,
    setConversationState,
    getUserData,
    resetConversation,
    startInactivityTimer,
    clearInactivityTimer,
    conversationStates,
    userData,
};