require("dotenv").config();
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const creds = require("./credentials.json");
const path = require("path");
const fs = require("fs");

const client = new Client({
  puppeteer: { headless: true, args: ["--no-sandbox"] },
  authStrategy: new LocalAuth({ clientId: "bot-sabor-casero" }),
  webVersionCache: {
    type: "remote",
    remotePath:
      "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2411.2.html",
  },
  authTimeoutMs: 60000,
  qrTimeout: 30000,
});

const conversationStates = {};
const userData = {};

function getServiceAccountAuth() {
  return new JWT({
    email: creds.client_email,
    key: creds.private_key.replace(/\\n/g, "\n"),
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.file",
    ],
  });
}

async function getMenuSheet() {
  const serviceAccountAuth = getServiceAccountAuth();
  const doc = new GoogleSpreadsheet(process.env.MENU, serviceAccountAuth);
  await doc.loadInfo();
  return doc;
}

function formatPrice(price) {
  if (!price) return "";
  let num = price.toString().replace(/\D/g, "");
  if (!num) return "";
  return "$ " + Number(num).toLocaleString("es-CO");
}

function resetConversation(from) {
  conversationStates[from] = null;
  userData[from] = {};
}

function generateOrderCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++)
    code += chars[Math.floor(Math.random() * chars.length)];
  return `ORDEN-${code}`;
}

function getDeliveryTime() {
  const now = new Date();
  const hour = now.getHours();
  if (hour >= 11 && hour < 16) return 20;
  if (hour >= 17 && hour < 21) return 40;
  return 40;
}

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

async function sendWelcomeImage(from) {
  // Puedes poner la ruta de tu logo aquí
  const logoPath = path.join(__dirname, "logo.jpg");
  if (fs.existsSync(logoPath)) {
    const media = MessageMedia.fromFilePath(logoPath);
    await client.sendMessage(from, media, {
      caption: "¡Bienvenido a Sabor Casero!",
    });
  }
}

let lastOrderNumber = 0;

async function getOrderSheet() {
  const serviceAccountAuth = getServiceAccountAuth();
  const doc = new GoogleSpreadsheet(
    process.env.ORDEN_STATE,
    serviceAccountAuth
  );
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle["ORDENES"];
  if (!sheet)
    throw new Error(
      "No se encontró la hoja 'ORDENES' en el archivo de Google Sheets."
    );
  return { doc, sheet };
}

async function getNextOrderNumber() {
  const { sheet } = await getOrderSheet();
  // Corregido: no se necesita loadCells
  const rows = await sheet.getRows();
  if (rows.length === 0) return 1;
  const lastRow = rows[rows.length - 1];
  const lastOrder = parseInt(lastRow._rawData[0]);
  return isNaN(lastOrder) ? 1 : lastOrder + 1;
}

function getColombiaDate() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Bogota" })
  );
}

// Utilidad para saber si es domingo
function isSunday() {
  return getColombiaDate().getDay() === 0;
}

// Utilidad para obtener fecha y hora por separado en zona Colombia
function getColombiaDateAndTime() {
  const now = getColombiaDate();
  const fecha = now.toLocaleDateString("es-CO"); // solo día/mes/año
  const hora = now.toLocaleTimeString("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return { fecha, hora };
}

async function saveOrderState(
  orderNumber,
  fecha,
  hora,
  items,
  estado,
  direccion,
  metodoPago,
  precioTotal
) {
  const { sheet } = await getOrderSheet();
  await sheet.addRow({
    "# ORDEN": orderNumber,
    FECHA: fecha,
    HORA: hora,
    "ITEMS DE LA ORDEN": items,
    "ESTADO DE ORDEN": estado,
    "DIRECCION DE LA ORDEN": direccion,
    "METODO DE PAGO": metodoPago,
    "PRECIO TOTAL": precioTotal,
  });
}

async function updateOrderState(orderNumber, estado) {
  const { sheet } = await getOrderSheet();
  const rows = await sheet.getRows();
  const row = rows.find((r) => r._rawData[0] == orderNumber);
  if (row) {
    row["ESTADO DE ORDEN"] = estado;
    await row.save();
  }
}

async function getOrderStatus(orderNumber) {
  const { sheet } = await getOrderSheet();
  const rows = await sheet.getRows();
  const row = rows.find((r) => r._rawData[0] == orderNumber);
  return row ? row["ESTADO DE ORDEN"] : null;
}

client.on("qr", (qr) => qrcode.generate(qr, { small: true }));
client.on("ready", () => console.log("Client is ready!"));
client.on("authenticated", () => console.log("Client is authenticated!"));
client.on("auth_failure", (msg) =>
  console.error("Authentication failure", msg)
);

client.on("message", async (msg) => {
  const from = msg.from;
  const body = msg.body.trim();

  // Inicia conversación si no hay estado
  if (!conversationStates[from]) {
    resetConversation(from);
    conversationStates[from] = "inicio";
    userData[from] = { cart: [], step: "inicio" };
    await sendWelcomeImage(from);
    await client.sendMessage(
      from,
      "¡Hola! 👋 Bienvenido a *Sabor Casero*.\n¿En qué te puedo ayudar hoy?\n\n" +
        "*1.* Ordenar 🍔\n*2.* ¿Dónde estamos ubicados? 📍\n*3.* Estado de mi pedido 🚚"
    );
    return;
  }
  try {
    const state = conversationStates[from];
    const data = userData[from];

    // INICIO
    if (state === "inicio") {
      if (body === "1") {
        // Iniciar pedido
        data.cart = [];
        data.step = "menu";
        conversationStates[from] = "menu";
        // Mostrar menú principal y Para Picar juntos con encabezados por color

        // --- Obtener menú principal con colores ---
        const doc = await getMenuSheet();
        const sheetMenu = doc.sheetsByTitle["MenuPrincipal"];
        const sheetPicar = doc.sheetsByTitle["Para Picar"];
        if (!sheetMenu || !sheetPicar) {
          await client.sendMessage(
            from,
            "No se encontró la hoja 'MenuPrincipal' o 'Para Picar' en el menú. Por favor, contacta al administrador."
          );
          resetConversation(from);
          return;
        }
        // Cargar colores
        await sheetMenu.loadCells("A1:A" + sheetMenu.rowCount);
        const rowsMenu = await sheetMenu.getRows();
        // Clasificar por color
        const plancha = [];
        const ahumados = [];
        const domingo = [];
        const normales = [];
        for (let i = 0; i < rowsMenu.length; i++) {
          const cell = sheetMenu.getCell(i + 1, 0);
          const color = cell.backgroundColor || {};
          const item = {
            name: rowsMenu[i]._rawData[0],
            price: Number(rowsMenu[i]._rawData[1]),
          };
          if (color.blue === 1) {
            plancha.push(item);
          } else if (color.red === 1) {
            ahumados.push(item);
          } else if (color.green === 1) {
            domingo.push(item);
          } else {
            normales.push(item);
          }
        }
        // Guardar para selección posterior
        data.menuPrincipal = [...plancha, ...ahumados, ...domingo, ...normales];
        // --- Obtener Para Picar ---
        const rowsPicar = await sheetPicar.getRows();
        data.paraPicar = rowsPicar.map((r) => ({
          name: r._rawData[0],
          price: Number(r._rawData[1]),
        }));

        // --- Construir mensaje de menú ---
        let menuMsg = "¡Excelente! Aquí tienes nuestro menú:\n\n";
        let idx = 1;
        // A LA PLANCHA
        if (plancha.length > 0) {
          menuMsg += "*A LA PLANCHA*\n(Arepa de chocolo/maíz)\n";
          plancha.forEach((item) => {
            menuMsg += `*${idx}.* ${item.name} - ${formatPrice(item.price)}\n`;
            idx++;
          });
        }
        // AHUMADOS
        if (ahumados.length > 0) {
          menuMsg += "\n*AHUMADOS*\n(Arepa de chocolo/maíz)\n";
          ahumados.forEach((item) => {
            menuMsg += `*${idx}.* ${item.name} - ${formatPrice(item.price)}\n`;
            idx++;
          });
        }
        // ESPECIALES DE DOMINGO (solo domingo)
        if (domingo.length > 0 && isSunday()) {
          menuMsg += "\n*ESPECIALES DE DOMINGO*\n";
          domingo.forEach((item) => {
            menuMsg += `*${idx}.* ${item.name} - ${formatPrice(item.price)}\n`;
            idx++;
          });
        }
        // Normales (sin color)
        if (normales.length > 0) {
          normales.forEach((item) => {
            menuMsg += `*${idx}.* ${item.name} - ${formatPrice(item.price)}\n`;
            idx++;
          });
        }
        // PARA PICAR
        if (data.paraPicar.length > 0) {
          menuMsg += "\n*PARA PICAR*\n";
          data.paraPicar.forEach((item) => {
            menuMsg += `*${idx}.* ${item.name} - ${formatPrice(item.price)}\n`;
            idx++;
          });
        }
        menuMsg += "\n*0.* Cancelar";
        // Guardar índice de corte para distinguir menú principal y para picar
        data.menuPrincipalCount =
          plancha.length +
          ahumados.length +
          (isSunday() ? domingo.length : 0) +
          normales.length;
        // Ajuste: Guarda el mensaje de menú en data.menuMsg al mostrarlo por primera vez
        data.menuMsg = menuMsg;
        await client.sendMessage(from, menuMsg);
        return;
      } else if (body === "2") {
        // Enviar ubicación como mapa
        await client.sendMessage(
          from,
          "Estamos ubicados en Calle 123 #45-67, Barrio Centro, Ciudad.\n¡Te esperamos!"
        );
        await client.sendMessage(
          from,
          "https://maps.google.com/?q=4.710989,-74.072090"
        );
        resetConversation(from);
        return;
      } else if (body === "3") {
        await client.sendMessage(
          from,
          "Por favor, indícanos tu número de orden para consultar el estado."
        );
        conversationStates[from] = "consulta_estado";
        return;
      } else {
        await client.sendMessage(
          from,
          "Por favor, selecciona una opción válida (1, 2 o 3)."
        );
        return;
      }
    }

    // Consulta estado de orden
    if (state === "consulta_estado") {
      const orderNumber = parseInt(body);
      if (isNaN(orderNumber)) {
        await client.sendMessage(
          from,
          "Por favor, ingresa un número de orden válido."
        );
        return;
      }
      const estado = await getOrderStatus(orderNumber);
      if (!estado) {
        await client.sendMessage(
          from,
          "No se encontró la orden. Verifica el número e intenta de nuevo."
        );
      } else {
        await client.sendMessage(
          from,
          `El estado de tu orden #${orderNumber} es: *${estado}*.`
        );
      }
      resetConversation(from);
      return;
    }

    // MENÚ PRINCIPAL
    if (state === "menu") {
      if (body === "0") {
        await client.sendMessage(
          from,
          "Pedido cancelado. Escribe cualquier mensaje para empezar de nuevo."
        );
        resetConversation(from);
        return;
      }
      const idx = parseInt(body) - 1;
      const totalOpciones =
        (data.menuPrincipal?.length || 0) + (data.paraPicar?.length || 0);
      if (isNaN(idx) || idx < 0 || idx >= totalOpciones) {
        await client.sendMessage(
          from,
          "Opción inválida. Por favor selecciona un número del menú."
        );
        return;
      }
      if (idx < data.menuPrincipalCount) {
        data.selectedItem = data.menuPrincipal[idx];
        conversationStates[from] = "cantidad_menu";
        await client.sendMessage(
          from,
          `Perfecto, ¿cuántas unidades de *${data.selectedItem.name}* deseas?`
        );
      } else {
        const paraPicarIdx = idx - data.menuPrincipalCount;
        data.selectedParaPicar = data.paraPicar[paraPicarIdx];
        conversationStates[from] = "cantidad_para_picar";
        await client.sendMessage(
          from,
          `¿Cuántas unidades de *${data.selectedParaPicar.name}* deseas?`
        );
      }
      return;
    }

    // CANTIDAD MENÚ PRINCIPAL
    if (state === "cantidad_menu") {
      const qty = parseInt(body);
      if (isNaN(qty) || qty <= 0) {
        await client.sendMessage(
          from,
          "Por favor, ingresa una cantidad válida (número mayor a 0)."
        );
        return;
      }
      data.cart.push({
        name: data.selectedItem.name,
        price: data.selectedItem.price,
        qty,
        type: "menu",
      });
      data.selectedItem = null;
      conversationStates[from] = "agregar_menu";
      await client.sendMessage(
        from,
        "¿Deseas ordenar otro plato de nuestro menú principal? (1. Sí / 2. No)"
      );
      return;
    }

    // AGREGAR MÁS DEL MENÚ PRINCIPAL
    if (state === "agregar_menu") {
      if (body === "1") {
        // Volver a mostrar el menú completo igual que al inicio
        let menuMsg = "¡Excelente! Aquí tienes nuestro menú:\n\n";
        let idx = 1;
        // A LA PLANCHA
        const plancha = data.menuPrincipal.filter(
          (item) =>
            item &&
            item.name &&
            item.name.toUpperCase &&
            item.name.toUpperCase().includes("PLANCHA")
        );
        const ahumados = data.menuPrincipal.filter(
          (item) =>
            item &&
            item.name &&
            item.name.toUpperCase &&
            item.name.toUpperCase().includes("AHUMADO")
        );
        const domingo = []; // Ya está controlado por isSunday en el armado original
        const normales = []; // No se requiere separar aquí, ya está armado el array
        // Pero para mantener el mismo menú, simplemente vuelve a armar el mensaje igual que al inicio:
        idx = 1;
        // A LA PLANCHA
        if (data.menuPrincipalCount > 0) {
          // Reconstruir el menú igual que al inicio
          // Para esto, puedes guardar el mensaje original en data.menuMsg al mostrarlo por primera vez
          if (data.menuMsg) {
            await client.sendMessage(from, data.menuMsg);
          } else {
            // Si no está guardado, vuelve a armarlo (copia el bloque de armado del menú del inicio aquí)
            // ...pero para evitar duplicidad, lo mejor es guardar data.menuMsg al mostrarlo por primera vez
          }
        }
        conversationStates[from] = "menu";
        return;
      } else if (body === "2") {
        conversationStates[from] = "ofrecer_bebidas";
        await client.sendMessage(
          from,
          "¿Te gustaría acompañar tu pedido con alguna bebida?\n1. Sí\n2. No"
        );
        return;
      } else {
        await client.sendMessage(
          from,
          "Por favor responde solo con 1 (Sí) o 2 (No)."
        );
        return;
      }
    }

    // OFRECER BEBIDAS
    if (state === "ofrecer_bebidas") {
      if (body === "1") {
        // Mostrar bebidas
        const doc = await getMenuSheet();
        const sheet = doc.sheetsByTitle["Bebidas"];
        if (!sheet) {
          await client.sendMessage(
            from,
            "No se encontró la hoja 'Bebidas' en el menú. Por favor, contacta al administrador."
          );
          conversationStates[from] = "resumen";
          const { lines, total } = getCartSummary(data.cart);
          let resumen =
            "¡Listo! ✨ Aquí está el resumen de tu pedido hasta ahora:\n\n";
          resumen +=
            lines.join("\n") +
            `\n\nTOTAL: ${formatPrice(
              total
            )}\n\n¿Qué deseas hacer?\n\n*1.* Modificar mi pedido ✏️\n*2.* Añadir instrucciones especiales 📝\n*3.* Confirmar y continuar ✅`;
          await client.sendMessage(from, resumen);
          return;
        }
        const rows = await sheet.getRows();
        data.bebidas = rows.map((r) => ({
          name: r._rawData[0],
          price: Number(r._rawData[1]),
        }));
        let bebidasMsg = "Estas son nuestras bebidas:\n";
        data.bebidas.forEach((item, i) => {
          bebidasMsg += `*${i + 1}.* ${item.name} - ${formatPrice(
            item.price
          )}\n`;
        });
        bebidasMsg += "\n*0.* No añadir bebidas";
        conversationStates[from] = "bebidas";
        await client.sendMessage(from, bebidasMsg);
        return;
      } else if (body === "2") {
        conversationStates[from] = "resumen";
        const { lines, total } = getCartSummary(data.cart);
        let resumen =
          "¡Listo! ✨ Aquí está el resumen de tu pedido hasta ahora:\n\n";
        resumen +=
          lines.join("\n") +
          `\n\nTOTAL: ${formatPrice(
            total
          )}\n\n¿Qué deseas hacer?\n\n*1.* Modificar mi pedido ✏️\n*2.* Añadir instrucciones especiales 📝\n*3.* Confirmar y continuar ✅`;
        await client.sendMessage(from, resumen);
        return;
      } else {
        await client.sendMessage(
          from,
          "Por favor responde solo con 1 (Sí) o 2 (No)."
        );
        return;
      }
    }

    // SELECCIÓN DE BEBIDAS
    if (state === "bebidas") {
      if (body === "0") {
        conversationStates[from] = "resumen";
        const { lines, total } = getCartSummary(data.cart);
        let resumen =
          "¡Listo! ✨ Aquí está el resumen de tu pedido hasta ahora:\n\n";
        resumen +=
          lines.join("\n") +
          `\n\nTOTAL: ${formatPrice(
            total
          )}\n\n¿Qué deseas hacer?\n\n*1.* Modificar mi pedido ✏️\n*2.* Añadir instrucciones especiales 📝\n*3.* Confirmar y continuar ✅`;
        await client.sendMessage(from, resumen);
        return;
      }
      const idx = parseInt(body) - 1;
      if (isNaN(idx) || idx < 0 || idx >= data.bebidas.length) {
        await client.sendMessage(
          from,
          "Opción inválida. Por favor selecciona una bebida válida."
        );
        return;
      }
      data.selectedBebida = data.bebidas[idx];
      conversationStates[from] = "cantidad_bebida";
      await client.sendMessage(
        from,
        `¿Cuántas unidades de *${data.selectedBebida.name}* deseas?`
      );
      return;
    }

    // CANTIDAD BEBIDA
    if (state === "cantidad_bebida") {
      const qty = parseInt(body);
      if (isNaN(qty) || qty <= 0) {
        await client.sendMessage(
          from,
          "Por favor, ingresa una cantidad válida (número mayor a 0)."
        );
        return;
      }
      data.cart.push({
        name: data.selectedBebida.name,
        price: data.selectedBebida.price,
        qty,
        type: "bebida",
      });
      data.selectedBebida = null;
      conversationStates[from] = "agregar_bebida";
      await client.sendMessage(
        from,
        "¿Deseas añadir otra bebida? (1. Sí / 2. No)"
      );
      return;
    }

    // AGREGAR MÁS BEBIDAS
    if (state === "agregar_bebida") {
      if (body === "1") {
        // Mostrar bebidas de nuevo
        let bebidasMsg = "Estas son nuestras bebidas:\n";
        data.bebidas.forEach((item, i) => {
          bebidasMsg += `*${i + 1}.* ${item.name} - ${formatPrice(
            item.price
          )}\n`;
        });
        bebidasMsg += "\n*0.* No añadir más bebidas";
        conversationStates[from] = "bebidas";
        await client.sendMessage(from, bebidasMsg);
        return;
      } else if (body === "2") {
        conversationStates[from] = "resumen";
        const { lines, total } = getCartSummary(data.cart);
        let resumen =
          "¡Listo! ✨ Aquí está el resumen de tu pedido hasta ahora:\n\n";
        resumen +=
          lines.join("\n") +
          `\n\nTOTAL: ${formatPrice(
            total
          )}\n\n¿Qué deseas hacer?\n\n*1.* Modificar mi pedido ✏️\n*2.* Añadir instrucciones especiales 📝\n*3.* Confirmar y continuar ✅`;
        await client.sendMessage(from, resumen);
        return;
      } else {
        await client.sendMessage(
          from,
          "Por favor responde solo con 1 (Sí) o 2 (No)."
        );
        return;
      }
    }

    // RESUMEN Y OPCIONES DEL PEDIDO
    if (state === "resumen") {
      if (body === "1") {
        // Modificar pedido
        if (!data.cart.length) {
          await client.sendMessage(from, "Tu carrito está vacío.");
          return;
        }
        let modMsg = "¿Qué ítem deseas modificar?\n";
        data.cart.forEach((item, i) => {
          modMsg += `*${i + 1}.* ${item.qty}x ${item.name}\n`;
        });
        modMsg += "\n*0.* Cancelar";
        conversationStates[from] = "modificar";
        await client.sendMessage(from, modMsg);
        return;
      } else if (body === "2") {
        conversationStates[from] = "instrucciones";
        await client.sendMessage(
          from,
          "Por favor, escribe tus instrucciones (ej. 'Sin azúcar', 'sin arroz', 'mucha salsa', etc.)."
        );
        return;
      } else if (body === "3") {
        conversationStates[from] = "nombre";
        await client.sendMessage(
          from,
          "Para finalizar, ¿a nombre de quién registramos el pedido?"
        );
        return;
      } else {
        await client.sendMessage(
          from,
          "Por favor selecciona una opción válida (1, 2 o 3)."
        );
        return;
      }
    }

    // MODIFICAR PEDIDO
    if (state === "modificar") {
      if (body === "0") {
        conversationStates[from] = "resumen";
        const { lines, total } = getCartSummary(data.cart);
        let resumen =
          "¡Listo! ✨ Aquí está el resumen de tu pedido hasta ahora:\n\n";
        resumen +=
          lines.join("\n") +
          `\n\nTOTAL: ${formatPrice(
            total
          )}\n\n¿Qué deseas hacer?\n\n*1.* Modificar mi pedido ✏️\n*2.* Añadir instrucciones especiales 📝\n*3.* Confirmar y continuar ✅`;
        await client.sendMessage(from, resumen);
        return;
      }
      const idx = parseInt(body) - 1;
      if (isNaN(idx) || idx < 0 || idx >= data.cart.length) {
        await client.sendMessage(
          from,
          "Opción inválida. Por favor selecciona un ítem válido."
        );
        return;
      }
      data.modificarIdx = idx;
      conversationStates[from] = "modificar_opcion";
      await client.sendMessage(
        from,
        `¿Qué deseas hacer con *${data.cart[idx].name}*?\n\na) Cambiar cantidad\nb) Eliminar del pedido`
      );
      return;
    }

    // OPCIÓN DE MODIFICACIÓN
    if (state === "modificar_opcion") {
      if (/^a$/i.test(body)) {
        conversationStates[from] = "modificar_cantidad";
        await client.sendMessage(
          from,
          `¿Cuál es la nueva cantidad para *${
            data.cart[data.modificarIdx].name
          }*?`
        );
        return;
      } else if (/^b$/i.test(body)) {
        data.cart.splice(data.modificarIdx, 1);
        data.modificarIdx = null;
        conversationStates[from] = "resumen";
        const { lines, total } = getCartSummary(data.cart);
        let resumen =
          "¡Listo! ✨ Aquí está el resumen de tu pedido actualizado:\n\n";
        resumen +=
          lines.join("\n") +
          `\n\nTOTAL: ${formatPrice(
            total
          )}\n\n¿Qué deseas hacer?\n\n*1.* Modificar mi pedido ✏️\n*2.* Añadir instrucciones especiales 📝\n*3.* Confirmar y continuar ✅`;
        await client.sendMessage(from, resumen);
        return;
      } else {
        await client.sendMessage(
          from,
          "Por favor responde 'a' para cambiar cantidad o 'b' para eliminar."
        );
        return;
      }
    }

    // CAMBIAR CANTIDAD DE ÍTEM
    if (state === "modificar_cantidad") {
      const qty = parseInt(body);
      if (isNaN(qty) || qty <= 0) {
        await client.sendMessage(
          from,
          "Por favor, ingresa una cantidad válida (número mayor a 0)."
        );
        return;
      }
      data.cart[data.modificarIdx].qty = qty;
      data.modificarIdx = null;
      conversationStates[from] = "resumen";
      const { lines, total } = getCartSummary(data.cart);
      let resumen =
        "¡Listo! ✨ Aquí está el resumen de tu pedido actualizado:\n\n";
      resumen +=
        lines.join("\n") +
        `\n\nTOTAL: ${formatPrice(
          total
        )}\n\n¿Qué deseas hacer?\n\n*1.* Modificar mi pedido ✏️\n*2.* Añadir instrucciones especiales 📝\n*3.* Confirmar y continuar ✅`;
      await client.sendMessage(from, resumen);
      return;
    }

    // INSTRUCCIONES ESPECIALES
    if (state === "instrucciones") {
      data.instrucciones = body;
      conversationStates[from] = "resumen";
      const { lines, total } = getCartSummary(data.cart);
      let resumen =
        "¡Listo! ✨ Aquí está el resumen de tu pedido hasta ahora:\n\n";
      resumen += lines.join("\n") + `\n\nTOTAL: ${formatPrice(total)}\n`;
      resumen += `\n*Instrucciones especiales:* "${data.instrucciones}"\n`;
      resumen +=
        "\n¿Qué deseas hacer?\n\n*1.* Modificar mi pedido ✏️\n*2.* Añadir instrucciones especiales 📝\n*3.* Confirmar y continuar ✅";
      await client.sendMessage(from, resumen);
      return;
    }

    // NOMBRE DEL CLIENTE
    if (state === "nombre") {
      data.nombre = body;
      conversationStates[from] = "direccion";
      await client.sendMessage(
        from,
        `¡Gracias, ${data.nombre}! Ahora, por favor, indícame la dirección completa para la entrega.`
      );
      return;
    }

    // DIRECCIÓN DE ENTREGA
    if (state === "direccion") {
      data.direccion = body;
      conversationStates[from] = "pago";
      await client.sendMessage(
        from,
        "¿Cómo deseas pagar?\n\n*1.* Nequi / Daviplata\n*2.* Efectivo"
      );
      return;
    }

    // MÉTODO DE PAGO
    if (state === "pago") {
      if (body === "1") {
        data.metodoPago = "Nequi / Daviplata";
        data.pagaCon = null;
        data.cambio = null;
        conversationStates[from] = "confirmacion";
        // Ejecutar confirmación inmediatamente
        // Generar resumen final
        const { lines, total } = getCartSummary(data.cart);
        const orderCode = await generateOrderCode();
        data.orderCode = orderCode;
        const tiempoEntrega = getDeliveryTime();
        let resumen = `¡Tu pedido ha sido confirmado! 🎉\n\n*Orden ${orderCode}*\nCliente: ${data.nombre}\nDirección: ${data.direccion}\nDetalle:\n\n`;
        resumen += lines.join("\n") + "\n";
        if (data.instrucciones)
          resumen += `\n*Instrucciones:* \"${data.instrucciones}\"\n`;
        resumen += `\n*Total a Pagar:* ${formatPrice(
          total
        )}\n*Método de Pago:* ${data.metodoPago}`;
        resumen += `\n\nTu orden se está preparando y llegará en aproximadamente *${tiempoEntrega} minutos*.\n¡Gracias por elegir Sabor Casero!`;
        await client.sendMessage(from, resumen);
        // Notificación al admin
        let adminMsg = `--- NUEVO PEDIDO ENTRANTE ---\n\nOrden ${orderCode}\n\nCliente: ${data.nombre}\nDirección: ${data.direccion}\n\nDETALLE DEL PEDIDO:\n\n`;
        adminMsg += lines.join("\n") + "\n";
        if (data.instrucciones)
          adminMsg += `\nInstrucciones Especiales: \"${data.instrucciones}\"\n`;
        adminMsg += `\nTOTAL: ${formatPrice(total)}\nPAGO: ${data.metodoPago}`;
        adminMsg += `\n\n--- FIN DEL PEDIDO ---`;
        await client.sendMessage(process.env.ADMIN_WHATSAPP_NUMBER, adminMsg);
        // Guardar en ORDEN_STATE con todos los datos
        const { fecha, hora } = getColombiaDateAndTime();
        const items =
          lines.join("\n") +
          (data.instrucciones ? `\nInstrucciones: ${data.instrucciones}` : "");
        await saveOrderState(
          orderCode,
          fecha,
          hora,
          items,
          "en preparación",
          data.direccion,
          data.metodoPago,
          total
        );
        resetConversation(from);
        return;
      } else if (body === "2") {
        data.metodoPago = "Efectivo";
        conversationStates[from] = "paga_con";
        const { total } = getCartSummary(data.cart);
        await client.sendMessage(
          from,
          `El total de tu pedido es ${formatPrice(
            total
          )}. ¿Con qué billete o monto pagarás para que podamos preparar tu cambio?`
        );
        return;
      } else {
        await client.sendMessage(
          from,
          "Por favor selecciona una opción válida (1 o 2)."
        );
        return;
      }
    }

    // PAGA CON (EFECTIVO)
    if (state === "paga_con") {
      const monto = parseInt(body.replace(/\D/g, ""));
      const { total } = getCartSummary(data.cart);
      if (isNaN(monto) || monto < total) {
        await client.sendMessage(
          from,
          `Por favor, ingresa un monto válido (mayor o igual a ${formatPrice(
            total
          )}).`
        );
        return;
      }
      data.pagaCon = monto;
      data.cambio = monto - total;
      conversationStates[from] = "confirmacion";
    }

    // CONFIRMACIÓN FINAL
    if (state === "confirmacion") {
      // Generar resumen final
      const { lines, total } = getCartSummary(data.cart);
      // Si ya existe un orderCode, úsalo, si no, genera uno único
      let orderCode = data.orderCode;
      if (!orderCode) {
        orderCode = generateOrderCode();
        data.orderCode = orderCode;
      }
      const tiempoEntrega = getDeliveryTime();
      let resumen = `¡Tu pedido ha sido confirmado! 🎉\n\n*Orden ${orderCode}*\nCliente: ${data.nombre}\nDirección: ${data.direccion}\nDetalle:\n\n`;
      resumen += lines.join("\n") + "\n";
      if (data.instrucciones)
        resumen += `\n*Instrucciones:* \"${data.instrucciones}\"\n`;
      resumen += `\n*Total a Pagar:* ${formatPrice(total)}\n*Método de Pago:* ${
        data.metodoPago
      }`;
      if (data.metodoPago === "Efectivo" && data.pagaCon) {
        resumen += `\nPagas con: ${formatPrice(
          data.pagaCon
        )}, cambio: ${formatPrice(data.cambio)}`;
      }
      resumen += `\n\nTu orden se está preparando y llegará en aproximadamente *${tiempoEntrega} minutos*.\n¡Gracias por elegir Sabor Casero!`;
      await client.sendMessage(from, resumen);
      // Notificación al admin
      let adminMsg = `--- NUEVO PEDIDO ENTRANTE ---\n\nOrden ${orderCode}\n\nCliente: ${data.nombre}\nDirección: ${data.direccion}\n\nDETALLE DEL PEDIDO:\n\n`;
      adminMsg += lines.join("\n") + "\n";
      if (data.instrucciones)
        adminMsg += `\nInstrucciones Especiales: \"${data.instrucciones}\"\n`;
      adminMsg += `\nTOTAL: ${formatPrice(total)}\nPAGO: ${data.metodoPago}`;
      if (data.metodoPago === "Efectivo" && data.pagaCon) {
        adminMsg += ` (Paga con ${formatPrice(
          data.pagaCon
        )}, cambio ${formatPrice(data.cambio)})`;
      }
      adminMsg += `\n\n--- FIN DEL PEDIDO ---`;
      await client.sendMessage(process.env.ADMIN_WHATSAPP_NUMBER, adminMsg);
      // Guardar en ORDEN_STATE con todos los datos
      const { fecha, hora } = getColombiaDateAndTime();
      const items =
        lines.join("\n") +
        (data.instrucciones ? `\nInstrucciones: ${data.instrucciones}` : "");
      await saveOrderState(
        orderCode,
        fecha,
        hora,
        items,
        "en preparación",
        data.direccion,
        data.metodoPago,
        total
      );
      resetConversation(from);
      return;
    }
  } catch (error) {
    console.error("Error en el flujo:", error);
    await client.sendMessage(
      from,
      "Ocurrió un error inesperado o no se encontró la hoja 'ORDENES'. Intenta de nuevo más tarde o contacta al administrador."
    );
    resetConversation(from);
  }
});

client
  .initialize()
  .then(() => console.log("Client initialized successfully"))
  .catch((err) => console.error("Error initializing client", err));

/**
 * Devuelve un array de objetos con el nombre del ítem y su color de fondo (si tiene).
 * Solo funciona si tienes permisos de edición en la hoja y la API lo soporta.
 */
async function getMenuItemsWithColor() {
  const doc = await getMenuSheet();
  const sheet = doc.sheetsByTitle["MenuPrincipal"];
  if (!sheet) throw new Error("No se encontró la hoja 'MenuPrincipal'");
  await sheet.loadCells("A1:A" + sheet.rowCount); // Ajusta el rango según tus datos

  const rows = await sheet.getRows();
  const items = [];
  for (let i = 0; i < rows.length; i++) {
    const cell = sheet.getCell(i + 1, 0); // +1 porque la fila 0 suele ser encabezado
    const color = cell.backgroundColor;
    items.push({
      name: rows[i]._rawData[0],
      color: color, // Ejemplo: {red:1,green:0.9,blue:0.2} o undefined/null si no hay color
    });
  }
  return items;
}

// --- Imprimir en consola si los ítems tienen color ---
(async () => {
  try {
    const items = await getMenuItemsWithColor();
    items.forEach((item) => {
      if (
        item.color &&
        (item.color.red !== undefined ||
          item.color.green !== undefined ||
          item.color.blue !== undefined)
      ) {
        console.log(`El ítem "${item.name}" tiene color:`, item.color);
      } else {
        console.log(`El ítem "${item.name}" NO tiene color`);
      }
    });
  } catch (e) {
    console.error("Error comprobando colores en MenuPrincipal:", e.message);
  }
})();
