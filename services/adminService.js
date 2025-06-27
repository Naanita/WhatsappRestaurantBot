// /services/adminService.js

const { getGoogleSheet } = require("../config/googleApi");
const { v4: uuidv4 } = require('uuid');

async function getAdminSheet() {
    const doc = await getGoogleSheet(process.env.ADMIN_VERIFICATION_SHEET_ID);
    const sheet = doc.sheetsByTitle["Verificaciones"];
    if (!sheet) {
        throw new Error("No se encontró la hoja 'Verificaciones' en el archivo de Google Sheets.");
    }
    return { doc, sheet };
}

async function logPaymentForVerification(data) {
    const { sheet } = await getAdminSheet();
    const verificationId = uuidv4().substring(0, 8);
    await sheet.addRow({
        'Verificación': verificationId, // <-- CORREGIDO
        'Número del Cliente': data.clientNumber,
        'Nombre del Cliente': data.clientName,
        'Items del Pedido': data.orderItems,
        'Monto': data.amount,
        'Método de Pago': data.paymentMethod,
        'Timestamp': data.timestamp,
        'Estado': 'Pendiente',
    });
    return verificationId;
}

async function updateVerificationStatus(verificationId, status) {
    const { sheet } = await getAdminSheet();
    const rows = await sheet.getRows();
    const row = rows.find(r => r.get('Verificación') === verificationId); // <-- CORREGIDO
    if (row) {
        row.set('Estado', status);
        await row.save();
    }
}

async function isVerificationPending(verificationId) {
    const { sheet } = await getAdminSheet();
    const rows = await sheet.getRows();
    const row = rows.find(r => r.get('Verificación') === verificationId); // <-- CORREGIDO
    return row && row.get('Estado') === 'Pendiente';
}

async function getLastPendingVerification() {
    const { sheet } = await getAdminSheet();
    const rows = await sheet.getRows();
    for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].get('Estado') === 'Pendiente') {
            return {
                id: rows[i].get('Verificación'), // <-- CORREGIDO
                clientNumber: rows[i].get('Número del Cliente'),
            };
        }
    }
    return null;
}

module.exports = {
    logPaymentForVerification,
    updateVerificationStatus,
    isVerificationPending,
    getLastPendingVerification,
};