const { getGoogleSheet } = require("../config/googleApi");
const { getColombiaDateAndTime } = require("../utils/helpers");

async function getOrderSheet() {
  const doc = await getGoogleSheet(process.env.ORDEN_STATE);
  const sheet = doc.sheetsByTitle["ORDENES"];
  if (!sheet) {
    throw new Error("No se encontró la hoja 'ORDENES' en el archivo de Google Sheets.");
  }
  return { doc, sheet };
}

async function saveOrderState(orderData) {
  const { sheet } = await getOrderSheet();
  const { fecha, hora } = getColombiaDateAndTime();
  // CORRECCIÓN: Se mantiene el uso de nombres de encabezado porque estos son fijos y controlados por el bot.
  await sheet.addRow({
    "# ORDEN": orderData.orderCode,
    FECHA: fecha,
    HORA: hora,
    NUMERO: orderData.from,
    CLIENTE: orderData.nombre,
    "DIRECCION DE LA ORDEN": orderData.direccion,
    "ITEMS DE LA ORDEN": orderData.items,
    "ESTADO DE ORDEN": "en preparación",
    "METODO DE PAGO": orderData.metodoPago,
    "PRECIO TOTAL": orderData.total,
  });
}

async function getOrderFullInfo(orderCode) {
  const { sheet } = await getOrderSheet();
  const rows = await sheet.getRows();
  const normalizedOrderCode = orderCode.toUpperCase().replace(/\s/g, "");
  
  // CORRECCIÓN: Usar _rawData[0] para buscar, igual que el código original.
  const row = rows.find(r => (r.get(sheet.headerValues[0]) || "").toUpperCase().replace(/\s/g, "") === normalizedOrderCode);

  if (!row) return null;

  // CORRECCIÓN: Usar los nombres de encabezado definidos. Esto es más seguro aquí.
  return {
    "# ORDEN": row.get("# ORDEN"),
    FECHA: row.get("FECHA"),
    HORA: row.get("HORA"),
    NUMERO: row.get("NUMERO"),
    CLIENTE: row.get("CLIENTE"),
    "DIRECCION DE LA ORDEN": row.get("DIRECCION DE LA ORDEN"),
    "ITEMS DE LA ORDEN": row.get("ITEMS DE LA ORDEN"),
    "ESTADO DE ORDEN": row.get("ESTADO DE ORDEN"),
    "METODO DE PAGO": row.get("METODO DE PAGO"),
    "PRECIO TOTAL": row.get("PRECIO TOTAL"),
  };
}

async function generateUniqueOrderCode() {
  const { sheet } = await getOrderSheet();
  const rows = await sheet.getRows();
  // CORRECCIÓN: Usar el primer encabezado para obtener los códigos existentes.
  const existingCodes = new Set(rows.map(r => (r.get(sheet.headerValues[0]) || "").toUpperCase()));
  let code;
  let exists;

  do {
    const letters = "ABCDEFGHJKLMNPRSTUVWXYZ";
    const numbers = "0123456789";
    code =
      Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * letters.length)]).join("") +
      "-" +
      Array.from({ length: 3 }, () => numbers[Math.floor(Math.random() * numbers.length)]).join("");
    exists = existingCodes.has(code);
  } while (exists);

  return code;
}

module.exports = {
  saveOrderState,
  getOrderFullInfo,
  generateUniqueOrderCode,
};