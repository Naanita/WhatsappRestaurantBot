const { getGoogleSheet } = require("../config/googleApi");

async function getHistorialSheet() {
  const doc = await getGoogleSheet(process.env.HISTORIAL_USERS);
  let sheet = null;
  for (const title of Object.keys(doc.sheetsByTitle)) {
    if (title.replace(/\s/g, '').toUpperCase() === "HISTORIAL_USERS") {
      sheet = doc.sheetsByTitle[title];
      break;
    }
  }
  if (!sheet) {
    throw new Error("No se encontró la hoja 'HISTORIAL_USERS' en el archivo de Google Sheets.");
  }
  return sheet;
}

async function getUserHistorial(numero) {
  const sheet = await getHistorialSheet();
  const rows = await sheet.getRows();
  
  const row = rows.find(r => r.get(sheet.headerValues[0]) === numero);

  if (!row) return null;

  return {
    nombre: row.get(sheet.headerValues[1]), // Columna 1 para el nombre
    veces: parseInt(row.get(sheet.headerValues[2])) || 0, // Columna 2 para las veces
    row,
  };
}

async function updateUserHistorial(numero, nombre) {
  const sheet = await getHistorialSheet();
  const rows = await sheet.getRows();
  

  let row = rows.find(r => r.get(sheet.headerValues[0]) === numero);

  if (row) {
    const currentCount = parseInt(row.get(sheet.headerValues[2])) || 0;
    row.set(sheet.headerValues[2], currentCount + 1); // Actualiza "VECES"
    if (nombre && row.get(sheet.headerValues[1]) !== nombre) {
      row.set(sheet.headerValues[1], nombre); // Actualiza "NOMBRE"
    }
    await row.save();
  } else {

    await sheet.addRow({
      "NUMERO": numero,
      "NOMBRE DE USUARIO": nombre,
      "VECES QUE HA ESCRITO": 1
    });
  }
}

module.exports = {
  getUserHistorial,
  updateUserHistorial,
};