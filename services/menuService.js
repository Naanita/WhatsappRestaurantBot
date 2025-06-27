const { getGoogleSheet } = require("../config/googleApi");
const { formatPrice, isSunday } = require("../utils/helpers");

/**
 * Obtiene el documento de Google Sheets que contiene los menús.
 * @returns {Promise<GoogleSpreadsheet>}
 */
async function getMenuSheet() {
  return await getGoogleSheet(process.env.MENU);
}

/**
 * Obtiene las bebidas del menú.
 * @returns {Promise<Array<object>|null>} Un array de objetos de bebida o null si no se encuentra.
 */
async function getDrinksMenu() {
    const doc = await getMenuSheet();
    const sheet = doc.sheetsByTitle["Bebidas"];
    if (!sheet) {
        console.error("Hoja 'Bebidas' no encontrada en el menú.");
        return null;
    }
    const rows = await sheet.getRows();
    // CORRECCIÓN: Usar _rawData para acceder por índice de columna
    return rows.map((r) => ({
        name: r.get(sheet.headerValues[0]), // Accede por el primer encabezado
        price: Number(r.get(sheet.headerValues[1])), // Accede por el segundo encabezado
    }));
}

/**
 * Construye el mensaje de texto completo para el menú principal y "para picar".
 * @returns {Promise<{menuMsg: string, menuPrincipal: Array, paraPicar: Array, menuPrincipalCount: number}>}
 */
async function buildFullMenu() {
  const doc = await getMenuSheet();
  const sheetMenu = doc.sheetsByTitle["MenuPrincipal"];
  const sheetPicar = doc.sheetsByTitle["Para Picar"];

  if (!sheetMenu || !sheetPicar) {
    throw new Error("No se encontraron las hojas 'MenuPrincipal' o 'Para Picar'.");
  }

  await sheetMenu.loadCells("A1:A" + sheetMenu.rowCount);
  const rowsMenu = await sheetMenu.getRows();

  const plancha = [];
  const ahumados = [];
  const domingo = [];
  const normales = [];

  for (let i = 0; i < rowsMenu.length; i++) {
    const row = rowsMenu[i];
    const cell = sheetMenu.getCell(i + 1, 0);
    const color = cell.backgroundColor || {};
    // CORRECCIÓN: Usar _rawData para acceder por índice de columna
    const item = {
      name: row.get(sheetMenu.headerValues[0]),
      price: Number(row.get(sheetMenu.headerValues[1])),
    };
    
    if (color.blue === 1) plancha.push(item);
    else if (color.red === 1) ahumados.push(item);
    else if (color.green === 1) domingo.push(item);
    else normales.push(item);
  }
  
  const allMenuItems = [...plancha, ...ahumados, ...(isSunday() ? domingo : []), ...normales];

  const rowsPicar = await sheetPicar.getRows();
  // CORRECCIÓN: Usar _rawData para acceder por índice de columna
  const paraPicar = rowsPicar.map((r) => ({
    name: r.get(sheetPicar.headerValues[0]),
    price: Number(r.get(sheetPicar.headerValues[1])),
  }));

  // (El resto de la función para construir el mensaje sigue igual)
  let menuMsg = "¡Genial! 🎉 Aquí te comparto nuestro menú:\n\n";
  let idx = 1;

  if (plancha.length > 0) {
    menuMsg += "🔥 _*A LA PLANCHA*_\n(Arepa maíz, papa, ensalada)\n\n";
    plancha.forEach((item) => { menuMsg += `*${idx++}.* ${item.name} - ${formatPrice(item.price)}\n`; });
  }
  if (ahumados.length > 0) {
    menuMsg += "\n🔥 _*AHUMADOS*_\n(Arepa maíz, papa, ensalada)\n\n";
    ahumados.forEach((item) => { menuMsg += `*${idx++}.* ${item.name} - ${formatPrice(item.price)}\n`; });
  }
  if (domingo.length > 0 && isSunday()) {
    menuMsg += "\n🔥 _*ESPECIALES DE DOMINGO*_\n";
    domingo.forEach((item) => { menuMsg += `*${idx++}.* ${item.name} - ${formatPrice(item.price)}\n`; });
  }
  if (normales.length > 0) {
     normales.forEach((item) => { menuMsg += `*${idx++}.* ${item.name} - ${formatPrice(item.price)}\n`; });
  }

  const menuPrincipalCount = idx - 1;

  if (paraPicar.length > 0) {
    menuMsg += "\n🍢 _*PARA PICAR*_\nLos chuzos y el chorizo (Arepa de chocolo/maíz)\n\n";
    paraPicar.forEach((item) => { menuMsg += `*${idx++}.* ${item.name} - ${formatPrice(item.price)}\n`; });
  }

  menuMsg += "\n*0.* Cancelar";

  return { menuMsg, menuPrincipal: allMenuItems, paraPicar, menuPrincipalCount };
}

module.exports = {
  getMenuSheet,
  getDrinksMenu,
  buildFullMenu,
};