// services/orderService.js

const { getGoogleSheet } = require("../config/googleApi");
const { getColombiaDateAndTime } = require("../utils/helpers");

async function getOrderSheet() {
    try {
        const doc = await getGoogleSheet(process.env.ORDEN_STATE);
        const sheet = doc.sheetsByTitle["ORDENES"];
        if (!sheet) {
            throw new Error("No se encontró la hoja 'ORDENES' en el archivo de Google Sheets.");
        }
        return { doc, sheet };
    } catch (error) {
        console.error("Error al acceder a la hoja de órdenes:", error);
        throw new Error("No se pudo conectar con la base de datos de órdenes.");
    }
}

async function saveOrderState(orderData) {
    try {
        const { sheet } = await getOrderSheet();
        const { fecha, hora } = getColombiaDateAndTime();
        await sheet.addRow({
            "# ORDEN": orderData.orderCode,
            "FECHA": fecha,
            "HORA": hora,
            "NUMERO": orderData.from,
            "CLIENTE": orderData.nombre,
            "DIRECCION DE LA ORDEN": orderData.direccion,
            "ITEMS DE LA ORDEN": orderData.items,
            "ESTADO DE ORDEN": "en preparación",
            "METODO DE PAGO": orderData.metodoPago,
            "PRECIO TOTAL": orderData.total,
        });
    } catch (error) {
        console.error("Error al guardar el estado de la orden:", error);
        throw new Error("No se pudo guardar la orden en la base de datos.");
    }
}

async function getOrderFullInfo(orderCode) {
    try {
        const { sheet } = await getOrderSheet();
        const rows = await sheet.getRows();
        const normalizedOrderCode = orderCode.toUpperCase().trim();

        const row = rows.find(r => (r.get("# ORDEN") || "").toUpperCase().trim() === normalizedOrderCode);

        if (!row) return null;

        // Construir el objeto de retorno de forma segura
        const headers = sheet.headerValues;
        const orderInfo = {};
        headers.forEach(header => {
            orderInfo[header] = row.get(header) || "";
        });

        return orderInfo;
    } catch (error) {
        console.error("Error al obtener información de la orden:", error);
        throw new Error("No se pudo consultar la información de la orden.");
    }
}

async function generateUniqueOrderCode() {
    try {
        const { sheet } = await getOrderSheet();
        const rows = await sheet.getRows();
        const existingCodes = new Set(rows.map(r => (r.get("# ORDEN") || "").toUpperCase()));
        
        let code;
        let attempts = 0;
        const MAX_ATTEMPTS = 20;

        do {
            const letters = "ABCDEFGHJKLMNPRSTUVWXYZ";
            const numbers = "0123456789";
            code =
                Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * letters.length)]).join("") +
                "-" +
                Array.from({ length: 3 }, () => numbers[Math.floor(Math.random() * numbers.length)]).join("");
            
            if (attempts++ > MAX_ATTEMPTS) {
                // Medida de seguridad para evitar bucles infinitos
                throw new Error("No se pudo generar un código de orden único después de varios intentos.");
            }
        } while (existingCodes.has(code));

        return code;
    } catch (error) {
        console.error("Error al generar el código de orden único:", error);
        throw new Error("No se pudo generar el código de la orden.");
    }
}

module.exports = {
    saveOrderState,
    getOrderFullInfo,
    generateUniqueOrderCode,
};