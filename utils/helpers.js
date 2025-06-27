const path = require("path");
const fs = require("fs");
const { MessageMedia } = require("whatsapp-web.js");

/**
 * Formatea un número como moneda colombiana (COP).
 * @param {number|string} price - El precio a formatear.
 * @returns {string} - El precio formateado, ej: "$ 10.000".
 */
function formatPrice(price) {
    if (!price) return "";
    let num = price.toString().replace(/\D/g, "");
    if (!num) return "";
    return "$ " + Number(num).toLocaleString("es-CO");
}

/**
 * Calcula el tiempo de entrega estimado.
 * @returns {number} - El tiempo en minutos.
 */
function getDeliveryTime() {
    const now = new Date();
    const hour = now.getHours();
    if (hour >= 11 && hour < 16) return 20;
    if (hour >= 17 && hour < 21) return 40;
    return 40;
}

/**
 * Genera un resumen del carrito de compras.
 * @param {Array<object>} cart - El carrito del usuario.
 * @returns {{lines: Array<string>, total: number}} - Un objeto con las líneas del resumen y el total.
 */
function getCartSummary(cart) {
    let lines = [];
    let total = 0;
    cart.forEach((item) => {
        const subtotal = item.price * item.qty;
        total += subtotal;
        lines.push(`${item.qty}x ${item.name}: ${formatPrice(subtotal)}`);
    });
    return { lines, total };
}

/**
 * Envía la imagen de bienvenida del restaurante.
 * @param {string} from - El número del usuario.
 * @param {object} client - La instancia del cliente de whatsapp-web.js.
 */
async function sendWelcomeImage(from, client) {
    const logoPath = path.join(__dirname, "..", "logo.jpg");
    if (fs.existsSync(logoPath)) {
        const media = MessageMedia.fromFilePath(logoPath);
        await client.sendMessage(from, media, {
            caption: "¡Bienvenido a El Arepazo!",
        });
    }
}

/**
 * Obtiene un objeto Date en la zona horaria de Colombia.
 * @returns {Date}
 */
function getColombiaDate() {
    return new Date(
        new Date().toLocaleString("en-US", { timeZone: "America/Bogota" })
    );
}

/**
 * Verifica si el día actual es domingo en Colombia.
 * @returns {boolean}
 */
function isSunday() {
    return getColombiaDate().getDay() === 0;
}

/**
 * Obtiene la fecha y hora por separado en la zona horaria de Colombia.
 * @returns {{fecha: string, hora: string}}
 */
function getColombiaDateAndTime() {
    const now = getColombiaDate();
    const fecha = now.toLocaleDateString("es-CO"); // solo día/mes/año
    const hora = now.toLocaleTimeString("es-CO", {
        hour: "2-digit",
        minute: "2-digit",
    });
    return { fecha, hora };
}

module.exports = {
    formatPrice,
    getDeliveryTime,
    getCartSummary,
    sendWelcomeImage,
    getColombiaDate,
    isSunday,
    getColombiaDateAndTime,
};