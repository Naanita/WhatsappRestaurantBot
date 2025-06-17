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
    remotePath: "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2411.2.html",
  },
  authTimeoutMs: 60000,
  qrTimeout: 30000,
});

const conversationStates = {};
const userData = {};

function getServiceAccountAuth() {
  return new JWT({
    email: creds.client_email,
    key: creds.private_key.replace(/\\n/g, '\n'),
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
    ],
  });
}

async function getMenuSheet() {
  const serviceAccountAuth = getServiceAccountAuth();
  const doc = new GoogleSpreadsheet(process.env.GOOGLE_MENU, serviceAccountAuth);
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
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
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
  cart.forEach(item => {
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
    await client.sendMessage(from, media, { caption: "¡Bienvenido a Sabor Casero!" });
  }
}

client.on("qr", (qr) => qrcode.generate(qr, { small: true }));
client.on("ready", () => console.log("Client is ready!"));
client.on("authenticated", () => console.log("Client is authenticated!"));
client.on("auth_failure", (msg) => console.error("Authentication failure", msg));

client.on("message", async (msg) => {
  const from = msg.from;
  const body = msg.body.trim();

  // Inicia conversación si no hay estado
  if (!conversationStates[from]) {
    resetConversation(from);
    conversationStates[from] = "inicio";
    userData[from] = { cart: [], step: "inicio" };
    await sendWelcomeImage(from);
    await client.sendMessage(from,
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
        // Mostrar menú principal
        const doc = await getMenuSheet();
        const sheet = doc.sheetsByTitle["MenuPrincipal"];
        if (!sheet) {
          await client.sendMessage(from, "No se encontró la hoja 'MenuPrincipal' en el menú. Por favor, contacta al administrador.");
          resetConversation(from);
          return;
        }
        const rows = await sheet.getRows();
        data.menuPrincipal = rows.map(r => ({
          name: r._rawData[0],
          price: Number(r._rawData[1])
        }));
        let menuMsg = "¡Excelente! Aquí tienes nuestro menú principal:\n";
        data.menuPrincipal.forEach((item, i) => {
          menuMsg += `*${i + 1}.* ${item.name} - ${formatPrice(item.price)}\n`;
        });
        menuMsg += "\n*0.* Cancelar";
        await client.sendMessage(from, menuMsg);
        return;
      } else if (body === "2") {
        await client.sendMessage(from, "Estamos ubicados en Calle 123 #45-67, Barrio Centro, Ciudad.\n¡Te esperamos!");
        resetConversation(from);
        return;
      } else if (body === "3") {
        await client.sendMessage(from, "Por favor, indícanos tu número de orden para consultar el estado.");
        resetConversation(from);
        return;
      } else {
        await client.sendMessage(from, "Por favor, selecciona una opción válida (1, 2 o 3).");
        return;
      }
    }

    // MENÚ PRINCIPAL
    if (state === "menu") {
      if (body === "0") {
        await client.sendMessage(from, "Pedido cancelado. Escribe cualquier mensaje para empezar de nuevo.");
        resetConversation(from);
        return;
      }
      const idx = parseInt(body) - 1;
      if (isNaN(idx) || idx < 0 || idx >= data.menuPrincipal.length) {
        await client.sendMessage(from, "Opción inválida. Por favor selecciona un número del menú.");
        return;
      }
      data.selectedItem = data.menuPrincipal[idx];
      conversationStates[from] = "cantidad_menu";
      await client.sendMessage(from, `Perfecto, ¿cuántas unidades de *${data.selectedItem.name}* deseas?`);
      return;
    }

    // CANTIDAD MENÚ PRINCIPAL
    if (state === "cantidad_menu") {
      const qty = parseInt(body);
      if (isNaN(qty) || qty <= 0) {
        await client.sendMessage(from, "Por favor, ingresa una cantidad válida (número mayor a 0).");
        return;
      }
      data.cart.push({
        name: data.selectedItem.name,
        price: data.selectedItem.price,
        qty,
        type: "menu"
      });
      data.selectedItem = null;
      conversationStates[from] = "agregar_menu";
      await client.sendMessage(from, "¿Deseas ordenar otro plato de nuestro menú principal? (Sí / No)");
      return;
    }

    // AGREGAR MÁS DEL MENÚ PRINCIPAL
    if (state === "agregar_menu") {
      if (/^si$/i.test(body)) {
        conversationStates[from] = "menu";
        // Mostrar menú principal de nuevo
        let menuMsg = "Aquí tienes nuestro menú principal:\n";
        data.menuPrincipal.forEach((item, i) => {
          menuMsg += `*${i + 1}.* ${item.name} - ${formatPrice(item.price)}\n`;
        });
        menuMsg += "\n*0.* Cancelar";
        await client.sendMessage(from, menuMsg);
        return;
      } else if (/^no$/i.test(body)) {
        // Ofrecer bebidas
        conversationStates[from] = "ofrecer_bebidas";
        await client.sendMessage(from, "¿Te gustaría acompañar tu pedido con alguna bebida? (Sí / No)");
        return;
      } else {
        await client.sendMessage(from, "Por favor responde 'Sí' o 'No'.");
        return;
      }
    }

    // OFRECER BEBIDAS
    if (state === "ofrecer_bebidas") {
      if (/^si$/i.test(body)) {
        // Mostrar bebidas
        const doc = await getMenuSheet();
        const sheet = doc.sheetsByTitle["Bebidas"];
        if (!sheet) {
          await client.sendMessage(from, "No se encontró la hoja 'Bebidas' en el menú. Por favor, contacta al administrador.");
          conversationStates[from] = "ofrecer_adiciones";
          await client.sendMessage(from, "¿Quisieras agregar alguna adición a tu orden? (Papas, ensalada extra, etc.) (Sí / No)");
          return;
        }
        const rows = await sheet.getRows();
        data.bebidas = rows.map(r => ({
          name: r._rawData[0],
          price: Number(r._rawData[1])
        }));
        let bebidasMsg = "Estas son nuestras bebidas:\n";
        data.bebidas.forEach((item, i) => {
          bebidasMsg += `*${i + 1}.* ${item.name} - ${formatPrice(item.price)}\n`;
        });
        bebidasMsg += "\n*0.* No añadir bebidas";
        conversationStates[from] = "bebidas";
        await client.sendMessage(from, bebidasMsg);
        return;
      } else if (/^no$/i.test(body)) {
        conversationStates[from] = "ofrecer_adiciones";
        await client.sendMessage(from, "¿Quisieras agregar alguna adición a tu orden? (Papas, ensalada extra, etc.) (Sí / No)");
        return;
      } else {
        await client.sendMessage(from, "Por favor responde 'Sí' o 'No'.");
        return;
      }
    }

    // SELECCIÓN DE BEBIDAS
    if (state === "bebidas") {
      if (body === "0") {
        conversationStates[from] = "ofrecer_adiciones";
        await client.sendMessage(from, "¿Quisieras agregar alguna adición a tu orden? (Papas, ensalada extra, etc.) (Sí / No)");
        return;
      }
      const idx = parseInt(body) - 1;
      if (isNaN(idx) || idx < 0 || idx >= data.bebidas.length) {
        await client.sendMessage(from, "Opción inválida. Por favor selecciona una bebida válida.");
        return;
      }
      data.selectedBebida = data.bebidas[idx];
      conversationStates[from] = "cantidad_bebida";
      await client.sendMessage(from, `¿Cuántas unidades de *${data.selectedBebida.name}* deseas?`);
      return;
    }

    // CANTIDAD BEBIDA
    if (state === "cantidad_bebida") {
      const qty = parseInt(body);
      if (isNaN(qty) || qty <= 0) {
        await client.sendMessage(from, "Por favor, ingresa una cantidad válida (número mayor a 0).");
        return;
      }
      data.cart.push({
        name: data.selectedBebida.name,
        price: data.selectedBebida.price,
        qty,
        type: "bebida"
      });
      data.selectedBebida = null;
      conversationStates[from] = "agregar_bebida";
      await client.sendMessage(from, "¿Deseas añadir otra bebida? (Sí / No)");
      return;
    }

    // AGREGAR MÁS BEBIDAS
    if (state === "agregar_bebida") {
      if (/^si$/i.test(body)) {
        // Mostrar bebidas de nuevo
        let bebidasMsg = "Estas son nuestras bebidas:\n";
        data.bebidas.forEach((item, i) => {
          bebidasMsg += `*${i + 1}.* ${item.name} - ${formatPrice(item.price)}\n`;
        });
        bebidasMsg += "\n*0.* No añadir más bebidas";
        conversationStates[from] = "bebidas";
        await client.sendMessage(from, bebidasMsg);
        return;
      } else if (/^no$/i.test(body)) {
        conversationStates[from] = "ofrecer_adiciones";
        await client.sendMessage(from, "¿Quisieras agregar alguna adición a tu orden? (Papas, ensalada extra, etc.) (Sí / No)");
        return;
      } else {
        await client.sendMessage(from, "Por favor responde 'Sí' o 'No'.");
        return;
      }
    }

    // OFRECER ADICIONES
    if (state === "ofrecer_adiciones") {
      if (/^si$/i.test(body)) {
        // Mostrar adiciones
        const doc = await getMenuSheet();
        const sheet = doc.sheetsByTitle["Adiciones"];
        if (!sheet) {
          await client.sendMessage(from, "No se encontró la hoja 'Adiciones' en el menú. Por favor, contacta al administrador.");
          // Mostrar resumen directamente
          conversationStates[from] = "resumen";
          const { lines, total } = getCartSummary(data.cart);
          let resumen = "¡Listo! ✨ Aquí está el resumen de tu pedido hasta ahora:\n\n";
          resumen += lines.join("\n") + `\n\nTOTAL: ${formatPrice(total)}\n\n¿Qué deseas hacer?\n\n*1.* Modificar mi pedido ✏️\n*2.* Añadir instrucciones especiales 📝\n*3.* Confirmar y continuar ✅`;
          await client.sendMessage(from, resumen);
          return;
        }
        const rows = await sheet.getRows();
        data.adiciones = rows.map(r => ({
          name: r._rawData[0],
          price: Number(r._rawData[1])
        }));
        let adicionesMsg = "Estas son nuestras adiciones:\n";
        data.adiciones.forEach((item, i) => {
          adicionesMsg += `*${i + 1}.* ${item.name} - ${formatPrice(item.price)}\n`;
        });
        adicionesMsg += "\n*0.* No añadir adiciones";
        conversationStates[from] = "adiciones";
        await client.sendMessage(from, adicionesMsg);
        return;
      } else if (/^no$/i.test(body)) {
        // Mostrar resumen
        conversationStates[from] = "resumen";
        const { lines, total } = getCartSummary(data.cart);
        let resumen = "¡Listo! ✨ Aquí está el resumen de tu pedido hasta ahora:\n\n";
        resumen += lines.join("\n") + `\n\nTOTAL: ${formatPrice(total)}\n\n¿Qué deseas hacer?\n\n*1.* Modificar mi pedido ✏️\n*2.* Añadir instrucciones especiales 📝\n*3.* Confirmar y continuar ✅`;
        await client.sendMessage(from, resumen);
        return;
      } else {
        await client.sendMessage(from, "Por favor responde 'Sí' o 'No'.");
        return;
      }
    }

    // SELECCIÓN DE ADICIONES
    if (state === "adiciones") {
      if (body === "0") {
        conversationStates[from] = "resumen";
        const { lines, total } = getCartSummary(data.cart);
        let resumen = "¡Listo! ✨ Aquí está el resumen de tu pedido hasta ahora:\n\n";
        resumen += lines.join("\n") + `\n\nTOTAL: ${formatPrice(total)}\n\n¿Qué deseas hacer?\n\n*1.* Modificar mi pedido ✏️\n*2.* Añadir instrucciones especiales 📝\n*3.* Confirmar y continuar ✅`;
        await client.sendMessage(from, resumen);
        return;
      }
      const idx = parseInt(body) - 1;
      if (isNaN(idx) || idx < 0 || idx >= data.adiciones.length) {
        await client.sendMessage(from, "Opción inválida. Por favor selecciona una adición válida.");
        return;
      }
      data.selectedAdicion = data.adiciones[idx];
      conversationStates[from] = "cantidad_adicion";
      await client.sendMessage(from, `¿Cuántas unidades de *${data.selectedAdicion.name}* deseas?`);
      return;
    }

    // CANTIDAD ADICIÓN
    if (state === "cantidad_adicion") {
      const qty = parseInt(body);
      if (isNaN(qty) || qty <= 0) {
        await client.sendMessage(from, "Por favor, ingresa una cantidad válida (número mayor a 0).");
        return;
      }
      data.cart.push({
        name: data.selectedAdicion.name,
        price: data.selectedAdicion.price,
        qty,
        type: "adicion"
      });
      data.selectedAdicion = null;
      conversationStates[from] = "agregar_adicion";
      await client.sendMessage(from, "¿Deseas añadir otra adición? (Sí / No)");
      return;
    }

    // AGREGAR MÁS ADICIONES
    if (state === "agregar_adicion") {
      if (/^si$/i.test(body)) {
        // Mostrar adiciones de nuevo
        let adicionesMsg = "Estas son nuestras adiciones:\n";
        data.adiciones.forEach((item, i) => {
          adicionesMsg += `*${i + 1}.* ${item.name} - ${formatPrice(item.price)}\n`;
        });
        adicionesMsg += "\n*0.* No añadir más adiciones";
        conversationStates[from] = "adiciones";
        await client.sendMessage(from, adicionesMsg);
        return;
      } else if (/^no$/i.test(body)) {
        conversationStates[from] = "resumen";
        const { lines, total } = getCartSummary(data.cart);
        let resumen = "¡Listo! ✨ Aquí está el resumen de tu pedido hasta ahora:\n\n";
        resumen += lines.join("\n") + `\n\nTOTAL: ${formatPrice(total)}\n\n¿Qué deseas hacer?\n\n*1.* Modificar mi pedido ✏️\n*2.* Añadir instrucciones especiales 📝\n*3.* Confirmar y continuar ✅`;
        await client.sendMessage(from, resumen);
        return;
      } else {
        await client.sendMessage(from, "Por favor responde 'Sí' o 'No'.");
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
        await client.sendMessage(from, "Por favor, escribe tus instrucciones (ej. 'Sin azúcar', 'sin arroz', 'mucha salsa', etc.).");
        return;
      } else if (body === "3") {
        conversationStates[from] = "nombre";
        await client.sendMessage(from, "Para finalizar, ¿a nombre de quién registramos el pedido?");
        return;
      } else {
        await client.sendMessage(from, "Por favor selecciona una opción válida (1, 2 o 3).");
        return;
      }
    }

    // MODIFICAR PEDIDO
    if (state === "modificar") {
      if (body === "0") {
        conversationStates[from] = "resumen";
        const { lines, total } = getCartSummary(data.cart);
        let resumen = "¡Listo! ✨ Aquí está el resumen de tu pedido hasta ahora:\n\n";
        resumen += lines.join("\n") + `\n\nTOTAL: ${formatPrice(total)}\n\n¿Qué deseas hacer?\n\n*1.* Modificar mi pedido ✏️\n*2.* Añadir instrucciones especiales 📝\n*3.* Confirmar y continuar ✅`;
        await client.sendMessage(from, resumen);
        return;
      }
      const idx = parseInt(body) - 1;
      if (isNaN(idx) || idx < 0 || idx >= data.cart.length) {
        await client.sendMessage(from, "Opción inválida. Por favor selecciona un ítem válido.");
        return;
      }
      data.modificarIdx = idx;
      conversationStates[from] = "modificar_opcion";
      await client.sendMessage(from, `¿Qué deseas hacer con *${data.cart[idx].name}*?\n\na) Cambiar cantidad\nb) Eliminar del pedido`);
      return;
    }

    // OPCIÓN DE MODIFICACIÓN
    if (state === "modificar_opcion") {
      if (/^a$/i.test(body)) {
        conversationStates[from] = "modificar_cantidad";
        await client.sendMessage(from, `¿Cuál es la nueva cantidad para *${data.cart[data.modificarIdx].name}*?`);
        return;
      } else if (/^b$/i.test(body)) {
        data.cart.splice(data.modificarIdx, 1);
        data.modificarIdx = null;
        conversationStates[from] = "resumen";
        const { lines, total } = getCartSummary(data.cart);
        let resumen = "¡Listo! ✨ Aquí está el resumen de tu pedido actualizado:\n\n";
        resumen += lines.join("\n") + `\n\nTOTAL: ${formatPrice(total)}\n\n¿Qué deseas hacer?\n\n*1.* Modificar mi pedido ✏️\n*2.* Añadir instrucciones especiales 📝\n*3.* Confirmar y continuar ✅`;
        await client.sendMessage(from, resumen);
        return;
      } else {
        await client.sendMessage(from, "Por favor responde 'a' para cambiar cantidad o 'b' para eliminar.");
        return;
      }
    }

    // CAMBIAR CANTIDAD DE ÍTEM
    if (state === "modificar_cantidad") {
      const qty = parseInt(body);
      if (isNaN(qty) || qty <= 0) {
        await client.sendMessage(from, "Por favor, ingresa una cantidad válida (número mayor a 0).");
        return;
      }
      data.cart[data.modificarIdx].qty = qty;
      data.modificarIdx = null;
      conversationStates[from] = "resumen";
      const { lines, total } = getCartSummary(data.cart);
      let resumen = "¡Listo! ✨ Aquí está el resumen de tu pedido actualizado:\n\n";
      resumen += lines.join("\n") + `\n\nTOTAL: ${formatPrice(total)}\n\n¿Qué deseas hacer?\n\n*1.* Modificar mi pedido ✏️\n*2.* Añadir instrucciones especiales 📝\n*3.* Confirmar y continuar ✅`;
      await client.sendMessage(from, resumen);
      return;
    }

    // INSTRUCCIONES ESPECIALES
    if (state === "instrucciones") {
      data.instrucciones = body;
      conversationStates[from] = "resumen";
      const { lines, total } = getCartSummary(data.cart);
      let resumen = "¡Listo! ✨ Aquí está el resumen de tu pedido hasta ahora:\n\n";
      resumen += lines.join("\n") + `\n\nTOTAL: ${formatPrice(total)}\n`;
      resumen += `\n*Instrucciones especiales:* "${data.instrucciones}"\n`;
      resumen += "\n¿Qué deseas hacer?\n\n*1.* Modificar mi pedido ✏️\n*2.* Añadir instrucciones especiales 📝\n*3.* Confirmar y continuar ✅";
      await client.sendMessage(from, resumen);
      return;
    }

    // NOMBRE DEL CLIENTE
    if (state === "nombre") {
      data.nombre = body;
      conversationStates[from] = "direccion";
      await client.sendMessage(from, `¡Gracias, ${data.nombre}! Ahora, por favor, indícame la dirección completa para la entrega.`);
      return;
    }

    // DIRECCIÓN DE ENTREGA
    if (state === "direccion") {
      data.direccion = body;
      conversationStates[from] = "pago";
      await client.sendMessage(from, "¿Cómo deseas pagar?\n\n*1.* Nequi / Daviplata\n*2.* Efectivo");
      return;
    }

    // MÉTODO DE PAGO
    if (state === "pago") {
      if (body === "1") {
        data.metodoPago = "Nequi / Daviplata";
        data.pagaCon = null;
        data.cambio = null;
        conversationStates[from] = "confirmacion";
      } else if (body === "2") {
        data.metodoPago = "Efectivo";
        conversationStates[from] = "paga_con";
        const { total } = getCartSummary(data.cart);
        await client.sendMessage(from, `El total de tu pedido es ${formatPrice(total)}. ¿Con qué billete o monto pagarás para que podamos preparar tu cambio?`);
        return;
      } else {
        await client.sendMessage(from, "Por favor selecciona una opción válida (1 o 2).");
        return;
      }
    }

    // PAGA CON (EFECTIVO)
    if (state === "paga_con") {
      const monto = parseInt(body.replace(/\D/g, ""));
      const { total } = getCartSummary(data.cart);
      if (isNaN(monto) || monto < total) {
        await client.sendMessage(from, `Por favor, ingresa un monto válido (mayor o igual a ${formatPrice(total)}).`);
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
      const orderCode = generateOrderCode();
      data.orderCode = orderCode;
      const tiempoEntrega = getDeliveryTime();
      let resumen = `¡Tu pedido ha sido confirmado! 🎉\n\n*Orden #${orderCode}*\nCliente: ${data.nombre}\nDirección: ${data.direccion}\nDetalle:\n\n`;
      resumen += lines.join("\n") + "\n";
      if (data.instrucciones) resumen += `\n*Instrucciones:* "${data.instrucciones}"\n`;
      resumen += `\n*Total a Pagar:* ${formatPrice(total)}\n*Método de Pago:* ${data.metodoPago}`;
      if (data.metodoPago === "Efectivo" && data.pagaCon) {
        resumen += `\nPagas con: ${formatPrice(data.pagaCon)}, cambio: ${formatPrice(data.cambio)}`;
      }
      resumen += `\n\nTu orden se está preparando y llegará en aproximadamente *${tiempoEntrega} minutos*.\n¡Gracias por elegir Sabor Casero!`;
      await client.sendMessage(from, resumen);

      // Notificación al admin
      let adminMsg = `--- NUEVO PEDIDO ENTRANTE ---\n\nOrden #${orderCode}\n\nCliente: ${data.nombre}\nDirección: ${data.direccion}\n\nDETALLE DEL PEDIDO:\n\n`;
      adminMsg += lines.join("\n") + "\n";
      if (data.instrucciones) adminMsg += `\nInstrucciones Especiales: "${data.instrucciones}"\n`;
      adminMsg += `\nTOTAL: ${formatPrice(total)}\nPAGO: ${data.metodoPago}`;
      if (data.metodoPago === "Efectivo" && data.pagaCon) {
        adminMsg += ` (Paga con ${formatPrice(data.pagaCon)}, cambio ${formatPrice(data.cambio)})`;
      }
      adminMsg += `\n\n--- FIN DEL PEDIDO ---`;
      await client.sendMessage(process.env.ADMIN_WHATSAPP_NUMBER, adminMsg);

      resetConversation(from);
      return;
    }

  } catch (error) {
    console.error("Error en el flujo:", error);
    await client.sendMessage(from, "Ocurrió un error inesperado. Intenta de nuevo más tarde.");
    resetConversation(from);
  }
});

client
  .initialize()
  .then(() => console.log("Client initialized successfully"))
  .catch((err) => console.error("Error initializing client", err));