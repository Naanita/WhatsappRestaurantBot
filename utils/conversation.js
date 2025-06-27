const conversationStates = {};
const userData = {};

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
    return userData[from];
}

/**
 * Reinicia la conversación y los datos de un usuario.
 * @param {string} from - El número del usuario.
 */
function resetConversation(from) {
    conversationStates[from] = null;
    userData[from] = { cart: [], step: "inicio" }; // Se reinicia con un objeto base
}

module.exports = {
    getConversationState,
    setConversationState,
    getUserData,
    resetConversation,
    conversationStates, // Exportado para debugging si es necesario
    userData,           // Exportado para debugging si es necesario
};