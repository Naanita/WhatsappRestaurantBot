// services/menuService.js

const { getGoogleSheet } = require("../config/googleApi");
const { formatPrice, isSunday } = require("../utils/helpers");

// Caché en memoria para el menú
let menuCache = null;
let lastFetchTime = 0;
const CACHE_DURATION_MS = 15 * 60 * 1000; // 15 minutos

/**
 * Obtiene los datos del menú, usando caché si está disponible y es reciente.
 * @returns {Promise<object>}
 */
async function getCachedMenuData() {
    const now = Date.now();
    if (menuCache && (now - lastFetchTime < CACHE_DURATION_MS)) {
        console.log("Serving menu from cache.");
        return menuCache;
    }

    try {
        console.log("Fetching menu from Google Sheets...");
        const doc = await getGoogleSheet(process.env.MENU);
        const sheetMenu = doc.sheetsByTitle["MenuPrincipal"];
        const sheetPicar = doc.sheetsByTitle["Para Picar"];
        const sheetBebidas = doc.sheetsByTitle["Bebidas"];

        if (!sheetMenu || !sheetPicar || !sheetBebidas) {
            throw new Error("Una o más hojas de menú ('MenuPrincipal', 'Para Picar', 'Bebidas') no fueron encontradas.");
        }

        // Cargar celdas para colores
        await sheetMenu.loadCells("A1:A" + sheetMenu.rowCount);

        const [rowsMenu, rowsPicar, rowsBebidas] = await Promise.all([
            sheetMenu.getRows(),
            sheetPicar.getRows(),
            sheetBebidas.getRows(),
        ]);

        const menuData = {
            rowsMenu,
            rowsPicar,
            rowsBebidas,
            sheetMenu, // Para acceder a los colores
            sheetPicar,
            sheetBebidas,
        };

        menuCache = menuData;
        lastFetchTime = now;

        return menuData;
    } catch (error) {
        console.error("Error fetching menu from Google Sheets:", error);
        // Si falla, pero hay un caché antiguo, se puede devolver ese caché para no interrumpir el servicio.
        if (menuCache) {
            console.warn("Returning stale menu cache due to fetch error.");
            return menuCache;
        }
        throw error; // Si no hay caché, se propaga el error.
    }
}


/**
 * Construye el mensaje de texto completo para el menú principal y "para picar".
 * @returns {Promise<{menuMsg: string, menuPrincipal: Array, paraPicar: Array, menuPrincipalCount: number}>}
 */
async function buildFullMenu() {
    const { rowsMenu, rowsPicar, sheetMenu, sheetPicar } = await getCachedMenuData();

    const plancha = [];
    const ahumados = [];
    const domingo = [];
    const normales = [];

    rowsMenu.forEach((row, i) => {
        const cell = sheetMenu.getCell(i + 1, 0); // i+1 porque las filas de la hoja son 1-based
        const color = cell.backgroundColor || {};
        const item = {
            name: row.get(sheetMenu.headerValues[0]),
            price: Number(row.get(sheetMenu.headerValues[1])),
        };

        if (color.blue === 1) plancha.push(item);
        else if (color.red === 1) ahumados.push(item);
        else if (color.green === 1) domingo.push(item);
        else normales.push(item);
    });

    const activeSundayMenu = isSunday() ? domingo : [];
    const allMenuItems = [...plancha, ...ahumados, ...activeSundayMenu, ...normales];

    const paraPicar = rowsPicar.map((r) => ({
        name: r.get(sheetPicar.headerValues[0]),
        price: Number(r.get(sheetPicar.headerValues[1])),
    }));

    let menuMsg = "¡Genial! 🎉 Aquí te comparto nuestro menú:\n\n";
    let idx = 1;

    const buildSection = (title, items) => {
        if (items.length > 0) {
            menuMsg += `${title}\n`;
            items.forEach((item) => {
                menuMsg += `*${idx++}.* ${item.name} - ${formatPrice(item.price)}\n`;
            });
            menuMsg += "\n";
        }
    };

    buildSection("🔥 _*A LA PLANCHA*_\n(Arepa maíz, papa, ensalada)", plancha);
    buildSection("💨 _*AHUMADOS*_\n(Arepa maíz, papa, ensalada)", ahumados);
    if (isSunday()) {
        buildSection("🌟 _*ESPECIALES DE DOMINGO*_", domingo);
    }
    buildSection("", normales); // Items sin categoría

    const menuPrincipalCount = idx - 1;

    buildSection("🍢 _*PARA PICAR*_\n(Acompañados de arepa de chocolo/maíz)", paraPicar);

    menuMsg += "*0.* Cancelar";

    return { menuMsg, menuPrincipal: allMenuItems, paraPicar, menuPrincipalCount };
}

/**
 * Obtiene las bebidas del menú.
 * @returns {Promise<Array<object>>} Un array de objetos de bebida.
 */
async function getDrinksMenu() {
    const { rowsBebidas, sheetBebidas } = await getCachedMenuData();
    return rowsBebidas.map((r) => ({
        name: r.get(sheetBebidas.headerValues[0]),
        price: Number(r.get(sheetBebidas.headerValues[1])),
    }));
}


module.exports = {
    getDrinksMenu,
    buildFullMenu,
};