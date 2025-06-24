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
      caption: "¡Bienvenido a El Arepazo!",
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
  numero,
  cliente,
  direccion,
  items,
  estado,
  metodoPago,
  precioTotal
) {
  const { sheet } = await getOrderSheet();
  await sheet.addRow({
    "# ORDEN": orderNumber,
    FECHA: fecha,
    HORA: hora,
    NUMERO: numero,
    CLIENTE: cliente,
    "DIRECCION DE LA ORDEN": direccion,
    "ITEMS DE LA ORDEN": items,
    "ESTADO DE ORDEN": estado,
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
      "¡Hola! 👋 Bienvenido a *El Arepazo* 🫓.\nEstoy aquí para ayudarte. ¿Qué te gustaría hacer hoy?\n\n" +
        "*1.* Hacer un pedido 🫓\n*2.* Ver nuestra ubicación 📍 \n*3.* Consultar el estado de mi pedido 🚚"
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
        // Busca historial de usuario
        const historial = await getUserHistorial(from);
        if (historial) {
          data.nombre = historial.nombre;
          data.historialExists = true;
        } else {
          data.historialExists = false;
        }
        // Mostrar menú principal y Para Picar juntos con encabezados por color

        // --- Obtener menú principal con colores ---
        const doc = await getMenuSheet();
        const sheetMenu = doc.sheetsByTitle["MenuPrincipal"];
        const sheetPicar = doc.sheetsByTitle["Para Picar"];
        if (!sheetMenu || !sheetPicar) {
          await client.sendMessage(
            from,
            "⚠️ Lo sentimos, no pudimos encontrar las secciones MenuPrincipal o Para Picar en el menú. Por favor, contacta al administrador para verificar esta información. 🙏"
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
        let menuMsg = "¡Genial! 🎉 Aquí te comparto nuestro menú:\n\n";
        let idx = 1;
        // A LA PLANCHA
        if (plancha.length > 0) {
          menuMsg += "🔥 _*A LA PLANCHA*_\n(Arepa maíz, papa, ensalada)\n\n";
          plancha.forEach((item) => {
            menuMsg += `*${idx}.* ${item.name} - ${formatPrice(item.price)}\n`;
            idx++;
          });
        }
        // AHUMADOS
        if (ahumados.length > 0) {
          menuMsg += "\n🔥 _*AHUMADOS*_\n(Arepa maíz, papa, ensalada)\n\n";
          ahumados.forEach((item) => {
            menuMsg += `*${idx}.* ${item.name} - ${formatPrice(item.price)}\n`;
            idx++;
          });
        }
        // ESPECIALES DE DOMINGO (solo domingo)
        if (domingo.length > 0 && isSunday()) {
          menuMsg += "\n🔥 _*ESPECIALES DE DOMINGO*_\n";
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
          menuMsg += "\n🍢 _*PARA PICAR*_\nLos chuzos y el chorizo (Arepa de chocolo/maíz)\n\n";
          data.paraPicar.forEach((item) => {
            menuMsg += `*${idx}.* ${item.name} - ${formatPrice(item.price)}\n`;
            idx++;
          });
        }
        menuMsg += "\n*0.* Cancelar";
        // Guardar índice de corte para distinguir menú principal y para picar
        data.menuPrincipalCount = plancha.length + ahumados.length + (isSunday() ? domingo.length : 0) + normales.length;
        // Ajuste: Guarda el mensaje de menú en data.menuMsg al mostrarlo por primera vez
        data.menuMsg = menuMsg;
        await client.sendMessage(from, menuMsg);
        return;
      } else if (body === "2") {
        // Enviar ubicación como mapa
        await client.sendMessage(
          from,
          "📍 Estamos ubicados en:\nCalle 123 #45-67, Viterbo, Caldas.\n¡Te esperamos con los brazos abiertos! 🫶"
        );
        await client.sendMessage(
          from,
          "https://www.google.com/maps/@5.0679782,-75.8666766,18z?entry=ttu&g_ep=EgoyMDI1MDYxNy4wIKXMDSoASAFQAw%3D%3D"
        );
        resetConversation(from);
        return;
      } else if (body === "3") {
        await client.sendMessage(
          from,
          "🚚 Para revisar tu pedido, solo necesito tu *número de orden*. ¡Gracias!"
        );
        conversationStates[from] = "consulta_estado";
        return;
      } else {
        await client.sendMessage(
          from,
          "⚠️ Por favor, selecciona una opción válida: *1*, *2* o *3*."
        );
        return;
      }
    }

    // Consulta estado de orden
    if (state === "consulta_estado") {
      // Permite ingresar código tipo ABC-123 (no solo números)
      const orderCode = body.toUpperCase().replace(/\s/g, "");
      if (!/^[A-Z]{3}-\d{3}$/.test(orderCode)) {
        await client.sendMessage(
          from,
          "🔎 Necesito un número de orden válido para continuar.\n Usa este formato: *_ABC-123_*. ¡Gracias!"
        );
        return;
      }
      const info = await getOrderFullInfo(orderCode);
      if (!info) {
        await client.sendMessage(
          from,
          "😕 No pudimos encontrar tu orden.\n Revisa el número y vuelve a intentarlo, por favor."
        );
} else {
  // Prioriza el estado y muestra toda la info relevante con formato amigable
  let msgEstado = `📦 *Estado de tu pedido ${info["# ORDEN"]}:* ${info["ESTADO DE ORDEN"]}\n\n`;
  msgEstado += `🗓️ *Fecha:* ${info.FECHA}\n`;
  msgEstado += `⏰ *Hora:* ${info.HORA}\n`;
  msgEstado += `📍 *Dirección:* ${info["DIRECCION DE LA ORDEN"]}\n`;
  msgEstado += `💳 *Método de pago:* ${info["METODO DE PAGO"]}\n`;
  msgEstado += `💰 *Total:* ${formatPrice(info["PRECIO TOTAL"])}\n\n`;
  msgEstado += `📝 *Detalle del pedido:*\n${info["ITEMS DE LA ORDEN"]}`;

  await client.sendMessage(from, msgEstado);
}

      resetConversation(from);
      return;
    }

    // MENÚ PRINCIPAL
    if (state === "menu") {
      if (body === "0") {
        await client.sendMessage(
          from,
          "🛑 El pedido fue cancelado.\nSi deseas hacer uno nuevo, solo envíanos un mensaje. ¡Aquí estamos para ti!"
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
          "⚠️ Opción inválida.\nPor favor, selecciona un número del menú para continuar."
        );
        return;
      }
      if (idx < data.menuPrincipalCount) {
        data.selectedItem = data.menuPrincipal[idx];
        conversationStates[from] = "cantidad_menu";
        await client.sendMessage(
          from,
          `✅ Perfecto, ¿cuántas unidades de ${data.selectedItem.name} te gustaría ordenar?`
        );
      } else {
        const paraPicarIdx = idx - data.menuPrincipalCount;
        data.selectedParaPicar = data.paraPicar[paraPicarIdx];
        conversationStates[from] = "cantidad_para_picar";
        await client.sendMessage(
          from,
          `😋 ¿Cuántas unidades de ${data.selectedParaPicar.name} te gustaría pedir?`
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
          "⚠️ Por favor, ingresa una cantidad válida (un número mayor a 0)."
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
        "🍽️ ¿Te gustaría ordenar otro plato de nuestro _*menú principal*_?\n  Responde con:\n  *1.* Sí\n  *2.* No"
      );
      return;
    }

    // CANTIDAD PARA PICAR
    if (state === "cantidad_para_picar") {
      const qty = parseInt(body);
      if (isNaN(qty) || qty <= 0) {
        await client.sendMessage(
          from,
          "⚠️ Por favor, ingresa una cantidad válida (un número mayor a 0)."
        );
        return;
      }
      data.cart.push({
        name: data.selectedParaPicar.name,
        price: data.selectedParaPicar.price,
        qty,
        type: "para_picar",
      });
      data.selectedParaPicar = null;
      conversationStates[from] = "agregar_menu";
      await client.sendMessage(
        from,
        "🍽️ ¿Deseas ordenar otro plato de nuestro _*menú principal*_ o para _*picar*_?\nResponde con:\n *1.* Sí\n *2.* No"
      );
      return;
    }

    // AGREGAR MÁS DEL MENÚ PRINCIPAL
    if (state === "agregar_menu") {
      if (body === "1") {
        // Volver a mostrar el menú completo igual que al inicio
        let menuMsg = "😄 ¡Perfecto! Este es nuestro menú, disfruta explorándolo:\n\n";
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
          "🥤 ¿Te gustaría acompañar tu pedido con alguna _*bebida*_?\nResponde con:\n*1.* Sí\n*2.* No"
        );
        return;
      } else {
        await client.sendMessage(
          from,
          "⚠️ Por favor responde solo con 1 (Sí) o 2 (No)."
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
            "✅ ¡Listo! ✨ Aquí tienes el resumen de tu pedido hasta ahora:\n\n";
resumen =
  "✅ ¡Listo! ✨ Aquí tienes el *resumen de tu pedido* hasta ahora:\n\n" +
  lines.join("\n") +
  `\n\n💰 *TOTAL:* ${formatPrice(total)}\n\n` +
  "¿Qué deseas hacer?\n\n" +
  "*1.* Modificar mi pedido ✏️\n" +
  "*2.* Añadir instrucciones especiales 📝\n" +
  "*3.* Confirmar y continuar ✅";

await client.sendMessage(from, resumen);
return;

      }
      const rows = await sheet.getRows();
      data.bebidas = rows.map((r) => ({
        name: r._rawData[0],
        price: Number(r._rawData[1]),
      }));
      let bebidasMsg = "🥤 Estas son nuestras bebidas:\n";
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
          "✅ ¡Listo! ✨ Aquí tienes el *resumen de tu pedido* hasta ahora:\n\n";
        resumen +=
          lines.join("\n") +
          `\n\n💰 *TOTAL:* ${formatPrice(
            total
          )}\n\n¿Qué deseas hacer?\n\n*1.* Modificar mi pedido ✏️\n*2.* Añadir instrucciones especiales 📝\n*3.* Confirmar y continuar ✅`;
        await client.sendMessage(from, resumen);
        return;
      } else {
        await client.sendMessage(
          from,
          "⚠️ Por favor responde solo con 1 (Sí) o 2 (No)."
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
          `\n\n💰 *TOTAL:* ${formatPrice(
            total
          )}\n\n¿Qué deseas hacer?\n\n*1.* Modificar mi pedido ✏️\n*2.* Añadir instrucciones especiales 📝\n*3.* Confirmar y continuar ✅`;
        await client.sendMessage(from, resumen);
        return;
      }
      const idx = parseInt(body) - 1;
      if (isNaN(idx) || idx < 0 || idx >= data.bebidas.length) {
        await client.sendMessage(
          from,
          "⚠️ Opción inválida. Por favor selecciona una bebida válida."
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
          "⚠️ Por favor, ingresa una cantidad válida (número mayor a 0)."
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
        "🥤 ¿Deseas añadir otra bebida a tu pedido?\nResponde con:\n*1.* Sí\n*2.* No"
      );
      return;
    }

    // AGREGAR MÁS BEBIDAS
    if (state === "agregar_bebida") {
      if (body === "1") {
        // Mostrar bebidas de nuevo
        let bebidasMsg = "🥤 Estas son nuestras bebidas:\n";
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
          "✅ ¡Listo! ✨ Aquí tienes el *resumen de tu pedido* hasta ahora:\n\n";
        resumen +=
          lines.join("\n") +
          `\n\n💰 *TOTAL:* ${formatPrice(
            total
          )}\n\n¿Qué deseas hacer?\n\n*1.* Modificar mi pedido ✏️\n*2.* Añadir instrucciones especiales 📝\n*3.* Confirmar y continuar ✅`;
        await client.sendMessage(from, resumen);
        return;
      } else {
        await client.sendMessage(
          from,
          "⚠️ Por favor responde solo con 1 (Sí) o 2 (No)."
        );
        return;
      }
    }

    // RESUMEN Y OPCIONES DEL PEDIDO
    if (state === "resumen") {
      if (body === "1") {
        // Modificar pedido
        if (!data.cart.length) {
          await client.sendMessage(from, "⚠️ Tu carrito está vacío.");
          return;
        }
        let modMsg = "✏️ ¿Qué ítem del pedido deseas modificar?\n";
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
          "✍️ Cuéntanos cómo te gustaría personalizar tu pedido (por ejemplo: sin cebolla, extra queso, poco picante)."
        );
        return;
      } else if (body === "3") {
        // Si ya existe historial, salta a dirección
        if (data.historialExists && data.nombre) {
          conversationStates[from] = "direccion";
          await client.sendMessage(
            from,
            `🏡 ¡Perfecto, *${data.nombre}*!\n  Ahora, por favor indícame la dirección completa para la entrega. 📍`
          );
        } else {
          conversationStates[from] = "nombre";
          await client.sendMessage(
            from,
            "🧾 Para finalizar, ¿a nombre de quién registramos el pedido?"
          );
        }
        return;
      } else {
        await client.sendMessage(
          from,
          "⚠️ Por favor selecciona una opción válida (1, 2 o 3)."
        );
        return;
      }
    }

    // INSTRUCCIONES ESPECIALES
    if (state === "instrucciones") {
      data.instrucciones = body || ""; // Asegura que siempre sea string
      conversationStates[from] = "resumen";
      const { lines, total } = getCartSummary(data.cart);
      let resumen =
        "✅ ¡Listo! ✨ Aquí tienes el *resumen de tu pedido* hasta ahora:\n\n";
      resumen += lines.join("\n") + `\n\n💰 *TOTAL:* ${formatPrice(total)}\n`;
      resumen += `\n*Instrucciones especiales:* "${data.instrucciones}"\n`;
      resumen +=
        "\n¿Qué deseas hacer?\n\n*1.* Modificar mi pedido ✏️\n*2.* Añadir instrucciones especiales 📝\n*3.* Confirmar y continuar ✅";
      await client.sendMessage(from, resumen);
      return;
    }

    // MODIFICAR PEDIDO (corregido para evitar que el bot se caiga)
    if (state === "modificar") {
      const idx = parseInt(body) - 1;
      if (body === "0") {
        conversationStates[from] = "resumen";
        const { lines, total } = getCartSummary(data.cart);
        let resumen =
          "✅ ¡Listo! ✨ Aquí tienes el *resumen de tu pedido* hasta ahora:\n\n";
        resumen += lines.join("\n") + `\n\n💰 *TOTAL:* ${formatPrice(total)}\n`;
        if (data.instrucciones)
          resumen += `\n*Instrucciones especiales:* "${data.instrucciones}"\n`;
        resumen +=
          "\n¿Qué deseas hacer?\n\n*1.* Modificar mi pedido ✏️\n*2.* Añadir instrucciones especiales 📝\n*3.* Confirmar y continuar ✅";
        await client.sendMessage(from, resumen);
        return;
      }
      if (
        isNaN(idx) ||
        idx < 0 ||
        idx >= data.cart.length
      ) {
        await client.sendMessage(
          from,
          "⚠️ Opción inválida. Por favor selecciona el número de un ítem del pedido o 0 para cancelar."
        );
        return;
      }
      // Preguntar qué hacer con el ítem seleccionado
      data.modificarIdx = idx;
      conversationStates[from] = "modificar_accion";
      await client.sendMessage(
        from,
        `🔧 Para ${data.cart[idx].qty}x ${data.cart[idx].name}, elige una opción:
*1.* Cambiar cantidad
*2.* Quitar del pedido
*0.* Cancelar`
      );
      return;
    }

    // ACCIÓN SOBRE ÍTEM A MODIFICAR
    if (state === "modificar_accion") {
      const idx = data.modificarIdx;
      if (
        typeof idx !== "number" ||
        idx < 0 ||
        !data.cart ||
        idx >= data.cart.length
      ) {
        // Si por alguna razón el índice no es válido, vuelve al resumen
        conversationStates[from] = "resumen";
        await client.sendMessage(
          from,
          "Ocurrió un error al modificar el pedido. Volviendo al resumen."
        );
        return;
      }
      if (body === "0") {
        conversationStates[from] = "resumen";
        await client.sendMessage(from, "❌ Modificación cancelada.\nVolviendo al resumen del pedido... 🧾");
        return;
      }
      if (body === "1") {
        conversationStates[from] = "modificar_cantidad";
        await client.sendMessage(
          from,
          `¿Cuál es la nueva cantidad para *${data.cart[idx].name}*?`
        );
        return;
      }
      if (body === "2") {
        // Eliminar el ítem
        data.cart.splice(idx, 1);
        delete data.modificarIdx;
        conversationStates[from] = "resumen";
        const { lines, total } = getCartSummary(data.cart);
        let resumen =
          "✅ ¡Listo! ✨ Aquí tienes el *resumen de tu pedido* hasta ahora:\n\n";
        resumen += lines.join("\n") + `\n\n💰 *TOTAL:* ${formatPrice(total)}\n`;
        if (data.instrucciones)
          resumen += `\n*Instrucciones especiales:* "${data.instrucciones}"\n`;
        resumen +=
          "\n¿Qué deseas hacer?\n\n*1.* Modificar mi pedido ✏️\n*2.* Añadir instrucciones especiales 📝\n*3.* Confirmar y continuar ✅";
        await client.sendMessage(from, resumen);
        return;
      }
      await client.sendMessage(
        from,
        "⚠️ Por favor selecciona una opción válida: 1 (cambiar cantidad), 2 (eliminar), o 0 (cancelar)."
      );
      return;
    }

    // CAMBIAR CANTIDAD DE ÍTEM
    if (state === "modificar_cantidad") {
      const idx = data.modificarIdx;
      if (
        typeof idx !== "number" ||
        idx < 0 ||
        !data.cart ||
        idx >= data.cart.length
      ) {
        conversationStates[from] = "resumen";
        await client.sendMessage(
          from,
          "Ocurrió un error al modificar la cantidad. Volviendo al resumen."
        );
        return;
      }
      const qty = parseInt(body);
      if (isNaN(qty) || qty <= 0) {
        await client.sendMessage(
          from,
          "⚠️ Por favor, ingresa una cantidad válida (número mayor a 0)."
        );
        return;
      }
      data.cart[idx].qty = qty;
      delete data.modificarIdx;
      conversationStates[from] = "resumen";
      const { lines, total } = getCartSummary(data.cart);
      let resumen =
        "✅ ¡Listo! ✨ Aquí tienes el *resumen de tu pedido* hasta ahora:\n\n";
      resumen += lines.join("\n") + `\n\n💰 *TOTAL:* ${formatPrice(total)}\n`;
      if (data.instrucciones)
        resumen += `\n*Instrucciones especiales:* "${data.instrucciones}"\n`;
      resumen +=
        "\n¿Qué deseas hacer?\n\n*1.* Modificar mi pedido ✏️\n*2.* Añadir instrucciones especiales 📝\n*3.* Confirmar y continuar ✅";
      await client.sendMessage(from, resumen);
      return;
    }

    // === NUEVO: MANEJO DE ESTADO "nombre" ===
    if (state === "nombre") {
      data.nombre = body;
      conversationStates[from] = "direccion";
      await client.sendMessage(
        from,
        `🏡 ¡Perfecto, ${data.nombre}! \n
Ahora, por favor indícame la dirección completa para la entrega. 📍`
      );
      return;
    }

    // === NUEVO: MANEJO DE ESTADO "direccion" ===
    if (state === "direccion") {
      data.direccion = body;
      conversationStates[from] = "metodo_pago";
      await client.sendMessage(
        from,
        "💳 ¿Cómo deseas pagar tu pedido?\n*1.* Efectivo 💵\n*2.* Nequi 📲\n*3.* Daviplata 📲"
      );
      return;
    }

    // === NUEVO: MANEJO DE ESTADO "metodo_pago" ===
    if (state === "metodo_pago") {
      let metodo = "";
      if (body === "1") metodo = "Efectivo";
      else if (body === "2") metodo = "Nequi";
      else if (body === "3") metodo = "Daviplata";
      else {
        await client.sendMessage(
          from,
          "⚠️ Por favor selecciona una opción válida:\n*1.* Efectivo\n*2.* Nequi\n*3.* Daviplata"
        );
        return;
      }
      data.metodoPago = metodo;
      if (metodo === "Efectivo") {
        conversationStates[from] = "paga_con";
        await client.sendMessage(
          from,
          "💵 ¿Con cuánto vas a pagar?\n(Ejemplo: 50000)"
        );
} else {
  data.pagaCon = null;
  data.cambio = null;
  conversationStates[from] = "confirmacion";

  // --- INICIO BLOQUE CONFIRMACIÓN FINAL ---
  const { lines, total } = getCartSummary(data.cart);
  let orderCode = data.orderCode;
  if (!orderCode) {
    orderCode = await generateUniqueOrderCode();
    data.orderCode = orderCode;
  }
  const tiempoEntrega = getDeliveryTime();
  let resumen = `🎉 *¡Tu pedido ha sido confirmado!* 🎉\n\n` +
                `📦 *Orden:* ${orderCode}\n` +
                `🙋‍♂️ *Cliente:* ${data.nombre}\n` +
                `📍 *Dirección:* ${data.direccion}\n\n` +
                `🧾 *Detalle del pedido:*\n` +
                lines.join("\n") + "\n";

  if (data.instrucciones)
    resumen += `\n📝 *Instrucciones:* "${data.instrucciones}"\n`;

  resumen += `\n💰 *Total a pagar:* ${formatPrice(total)}\n` +
             `💳 *Método de pago:* ${data.metodoPago}`;

  if (data.metodoPago === "Efectivo" && data.pagaCon) {
    resumen += `\n💵 Pagas con: ${formatPrice(data.pagaCon)}\n` +
               `🔁 Cambio: ${formatPrice(data.cambio)}`;
  }

  resumen += `\n\n⏱️ Tu orden se está preparando y llegará en aproximadamente *${tiempoEntrega} minutos*.\n` +
             `¡Gracias por elegir *El Arepazo*! 🧡`;

  await client.sendMessage(from, resumen);

  try {
    const stickerPath = path.join(__dirname, "sticker.webp");
    if (fs.existsSync(stickerPath)) {
      const stickerMedia = MessageMedia.fromFilePath(stickerPath);
      await client.sendMessage(from, stickerMedia, { sendMediaAsSticker: true });
    }
  } catch (e) {
    console.error("No se pudo enviar el sticker:", e);
  }

  // Notificación al administrador
  let adminMsg = `🚨 *NUEVO PEDIDO ENTRANTE* 🚨\n\n` +
                 `📦 *Orden:* ${orderCode}\n` +
                 `🙋‍♂️ *Cliente:* ${data.nombre}\n` +
                 `📍 *Dirección:* ${data.direccion}\n\n` +
                 `🧾 *Detalle del pedido:*\n` +
                 lines.join("\n") + "\n";

  if (data.instrucciones)
    adminMsg += `\n📝 *Instrucciones especiales:* "${data.instrucciones}"\n`;

  adminMsg += `\n💰 *TOTAL:* ${formatPrice(total)}\n` +
              `💳 *PAGO:* ${data.metodoPago}\n\n` +
              `✅ *Fin del pedido*`;

  await client.sendMessage(process.env.ADMIN_WHATSAPP_NUMBER, adminMsg);

  // Guardar pedido
  const { fecha, hora } = getColombiaDateAndTime();
  const items = lines.join("\n") +
                (data.instrucciones ? `\nInstrucciones: ${data.instrucciones}` : "");

  await saveOrderState(
    orderCode,
    fecha,
    hora,
    from,
    data.nombre,
    data.direccion,
    items,
    "en preparación",
    data.metodoPago,
    total
  );

  await updateUserHistorial(from, data.nombre);
  resetConversation(from);
  // --- FIN BLOQUE CONFIRMACIÓN FINAL ---
}

      return;
    }

    // === NUEVO: MANEJO DE ESTADO "paga_con" ===
if (state === "paga_con") {
  const { total } = getCartSummary(data.cart);
  const pagaCon = parseInt(body.replace(/\D/g, ""));
  
  if (isNaN(pagaCon) || pagaCon < total) {
    await client.sendMessage(
      from,
      `⚠️ Por favor, ingresa un valor válido mayor o igual al total de tu pedido (${formatPrice(total)}).`
    );
    return;
  }

  data.pagaCon = pagaCon;
  data.cambio = pagaCon - total;
  conversationStates[from] = "confirmacion";

  // --- INICIO BLOQUE CONFIRMACIÓN FINAL ---
  const { lines, total: totalPedido } = getCartSummary(data.cart);
  let orderCode = data.orderCode;
  if (!orderCode) {
    orderCode = await generateUniqueOrderCode();
    data.orderCode = orderCode;
  }

  const tiempoEntrega = getDeliveryTime();

  let resumen = `🎉 *¡Tu pedido ha sido confirmado!* 🎉\n\n` +
                `📦 *Orden:* ${orderCode}\n` +
                `🙋‍♂️ *Cliente:* ${data.nombre}\n` +
                `📍 *Dirección:* ${data.direccion}\n\n` +
                `🧾 *Detalle del pedido:*\n` +
                lines.join("\n") + "\n";

  if (data.instrucciones)
    resumen += `\n📝 *Instrucciones:* "${data.instrucciones}"\n`;

  resumen += `\n💰 *Total a pagar:* ${formatPrice(totalPedido)}\n` +
             `💳 *Método de pago:* ${data.metodoPago}`;

  if (data.metodoPago === "Efectivo" && data.pagaCon) {
    resumen += `\n💵 Pagas con: ${formatPrice(data.pagaCon)}\n` +
               `🔁 Cambio: ${formatPrice(data.cambio)}`;
  }

  resumen += `\n\n⏱️ Tu orden se está preparando y llegará en aproximadamente *${tiempoEntrega} minutos*.\n` +
             `¡Gracias por elegir *El Arepazo*! 🧡`;

  await client.sendMessage(from, resumen);

  // Envío de sticker
  try {
    const stickerPath = path.join(__dirname, "sticker.webp");
    if (fs.existsSync(stickerPath)) {
      const stickerMedia = MessageMedia.fromFilePath(stickerPath);
      await client.sendMessage(from, stickerMedia, { sendMediaAsSticker: true });
    }
  } catch (e) {
    console.error("No se pudo enviar el sticker:", e);
  }

  // Notificación al administrador
  let adminMsg = `🚨 *NUEVO PEDIDO ENTRANTE* 🚨\n\n` +
                 `📦 *Orden:* ${orderCode}\n` +
                 `🙋‍♂️ *Cliente:* ${data.nombre}\n` +
                 `📍 *Dirección:* ${data.direccion}\n\n` +
                 `🧾 *Detalle del pedido:*\n` +
                 lines.join("\n") + "\n";

  if (data.instrucciones)
    adminMsg += `\n📝 *Instrucciones especiales:* "${data.instrucciones}"\n`;

  adminMsg += `\n💰 *TOTAL:* ${formatPrice(totalPedido)}\n` +
              `💳 *PAGO:* ${data.metodoPago}\n\n` +
              `✅ *Fin del pedido*`;

  await client.sendMessage(process.env.ADMIN_WHATSAPP_NUMBER, adminMsg);

  // Guardar el pedido
  const { fecha, hora } = getColombiaDateAndTime();
  const items = lines.join("\n") +
                (data.instrucciones ? `\nInstrucciones: ${data.instrucciones}` : "");

  await saveOrderState(
    orderCode,
    fecha,
    hora,
    from,
    data.nombre,
    data.direccion,
    items,
    "en preparación",
    data.metodoPago,
    totalPedido
  );

  await updateUserHistorial(from, data.nombre);
  resetConversation(from);
  // --- FIN BLOQUE CONFIRMACIÓN FINAL ---
  return;
}


    // CONFIRMACIÓN FINAL
if (state === "confirmacion") {
  // Generar resumen final
  const { lines, total } = getCartSummary(data.cart);
  let orderCode = data.orderCode;
  if (!orderCode) {
    orderCode = await generateUniqueOrderCode();
    data.orderCode = orderCode;
  }

  const tiempoEntrega = getDeliveryTime();

  let resumen = `🎉 *¡Tu pedido ha sido confirmado!* 🎉\n\n` +
                `📦 *Orden:* ${orderCode}\n` +
                `🙋‍♂️ *Cliente:* ${data.nombre}\n` +
                `📍 *Dirección:* ${data.direccion}\n\n` +
                `🧾 *Detalle del pedido:*\n` +
                lines.join("\n") + "\n";

  if (data.instrucciones)
    resumen += `\n📝 *Instrucciones:* "${data.instrucciones}"\n`;

  resumen += `\n💰 *Total a pagar:* ${formatPrice(total)}\n` +
             `💳 *Método de pago:* ${data.metodoPago}`;

  if (data.metodoPago === "Efectivo" && data.pagaCon) {
    resumen += `\n💵 Pagas con: ${formatPrice(data.pagaCon)}\n` +
               `🔁 Cambio: ${formatPrice(data.cambio)}`;
  }

  resumen += `\n\n⏱️ Tu orden se está preparando y llegará en aproximadamente *${tiempoEntrega} minutos*.\n` +
             `¡Gracias por elegir *El Arepazo*! 🧡`;

  await client.sendMessage(from, resumen);

  // Enviar sticker de confirmación
  try {
    const stickerPath = path.join(__dirname, "sticker.webp");
    if (fs.existsSync(stickerPath)) {
      const stickerMedia = MessageMedia.fromFilePath(stickerPath);
      await client.sendMessage(from, stickerMedia, { sendMediaAsSticker: true });
    }
  } catch (e) {
    console.error("No se pudo enviar el sticker:", e);
  }

  // Notificación al administrador
  let adminMsg = `🚨 *NUEVO PEDIDO ENTRANTE* 🚨\n\n` +
                 `📦 *Orden:* ${orderCode}\n` +
                 `🙋‍♂️ *Cliente:* ${data.nombre}\n` +
                 `📍 *Dirección:* ${data.direccion}\n\n` +
                 `🧾 *Detalle del pedido:*\n` +
                 lines.join("\n") + "\n";

  if (data.instrucciones)
    adminMsg += `\n📝 *Instrucciones especiales:* "${data.instrucciones}"\n`;

  adminMsg += `\n💰 *TOTAL:* ${formatPrice(total)}\n` +
              `💳 *PAGO:* ${data.metodoPago}\n\n` +
              `✅ *Fin del pedido*`;

  await client.sendMessage(process.env.ADMIN_WHATSAPP_NUMBER, adminMsg);

  // Guardar en ORDEN_STATE
  const { fecha, hora } = getColombiaDateAndTime();
  const items = lines.join("\n") +
                (data.instrucciones ? `\nInstrucciones: ${data.instrucciones}` : "");

  await saveOrderState(
    orderCode,
    fecha,
    hora,
    from,
    data.nombre,
    data.direccion,
    items,
    "en preparación",
    data.metodoPago,
    total
  );

  // Actualiza historial de usuario
  await updateUserHistorial(from, data.nombre);
  resetConversation(from);
  return;
}
else {
      await client.sendMessage(
        from,
        "Ocurrió un error inesperado o no se encontró la hoja 'ORDENES'. Intenta de nuevo más tarde o contacta al administrador."
      );
      resetConversation(from);
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
// (async () => {
//   try {
//     const items = await getMenuItemsWithColor();
//     items.forEach((item) => {
//       if (
//         item.color &&
//         (item.color.red !== undefined ||
//           item.color.green !== undefined ||
//           item.color.blue !== undefined)
//       ) {
//         console.log(`El ítem "${item.name}" tiene color:`, item.color);
//       } else {
//         console.log(`El ítem "${item.name}" NO tiene color`);
//       }
//     });
//   } catch (e) {
//     console.error("Error comprobando colores en MenuPrincipal:", e.message);
//   }
// })();

// Genera un código único tipo ABC-123 y valida que no exista en ORDEN_STATE
async function generateUniqueOrderCode() {
  const { sheet } = await getOrderSheet();
  const rows = await sheet.getRows();
  let code, exists;
  do {
    const letters = "ABCDEFGHJKLMNPRSTUVWXYZ";
    const numbers = "0123456789";
    code =
      Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * letters.length)]).join("") +
      "-" +
      Array.from({ length: 3 }, () => numbers[Math.floor(Math.random() * numbers.length)]).join("");
    exists = rows.some((r) => (r._rawData[0] || "").toUpperCase() === code);
  } while (exists);
  return code;
}

async function getHistorialSheet() {
  // Usa la variable de entorno HISTORIAL_USERS para el ID del archivo de historial
  const serviceAccountAuth = getServiceAccountAuth();
  const doc = new GoogleSpreadsheet(process.env.HISTORIAL_USERS, serviceAccountAuth);
  await doc.loadInfo();
  // Buscar hoja ignorando mayúsculas/minúsculas y espacios
  let sheet = null;
  for (const title of Object.keys(doc.sheetsByTitle)) {
    if (title.replace(/\s/g, '').toUpperCase() === "HISTORIAL_USERS") {
      sheet = doc.sheetsByTitle[title];
      break;
    }
  }
  if (!sheet)
    throw new Error("No se encontró la hoja 'HISTORIAL_USERS' en el archivo de Google Sheets.");
  return sheet;
}

// Busca usuario en historial, retorna {nombre, veces} o null
async function getUserHistorial(numero) {
  const sheet = await getHistorialSheet();
  const rows = await sheet.getRows();
  const row = rows.find(r => (r._rawData[0] || "") === numero);
  if (!row) return null;
  return {
    nombre: row._rawData[1],
    veces: parseInt(row._rawData[2]) || 0,
    row
  };
}

// Actualiza o crea historial de usuario
async function updateUserHistorial(numero, nombre) {
  const sheet = await getHistorialSheet();
  const rows = await sheet.getRows();
  let row = rows.find(r => (r._rawData[0] || "") === numero);
  if (row) {
    row._rawData[2] = (parseInt(row._rawData[2]) || 0) + 1;
    row["VECES QUE HA ESCRITO"] = row._rawData[2];
    // Si el nombre cambió, actualízalo
    if (nombre && row._rawData[1] !== nombre) {
      row._rawData[1] = nombre;
      row["NOMBRE DE USUARIO"] = nombre;
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

// Consulta toda la info de la orden por código (ajustado a nuevas columnas)
async function getOrderFullInfo(orderCode) {
  const { sheet } = await getOrderSheet();
  const rows = await sheet.getRows();
  const row = rows.find((r) => ((r._rawData[0] || "").toUpperCase().replace(/\s/g, "")) === orderCode.toUpperCase().replace(/\s/g, ""));
  if (!row) return null;
  return {
    "# ORDEN": row._rawData[0],
    FECHA: row._rawData[1],
    HORA: row._rawData[2],
    NUMERO: row._rawData[3],
    CLIENTE: row._rawData[4],
    "DIRECCION DE LA ORDEN": row._rawData[5],
    "ITEMS DE LA ORDEN": row._rawData[6],
    "ESTADO DE ORDEN": row._rawData[7],
    "METODO DE PAGO": row._rawData[8],
    "PRECIO TOTAL": row._rawData[9],
  };
}
