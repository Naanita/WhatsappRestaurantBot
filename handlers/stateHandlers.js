const {
    formatPrice,
    getCartSummary,
    getDeliveryTime,
    isSunday,
} = require("../utils/helpers");
const conv = require("../utils/conversation");
const menuService = require("../services/menuService");
const orderService = require("../services/orderService");
const historyService = require("../services/historyService");
const adminService = require("../services/adminService"); 
const path = require("path");
const fs = require("fs");
const { MessageMedia } = require("whatsapp-web.js");


// --- Lógica de Manejadores de Estado ---

async function handleInicio(from, body, client) {
    const data = conv.getUserData(from);

    if (body === "1") {
        // --- Iniciar Pedido ---
        data.cart = [];
        conv.setConversationState(from, "menu");

        const historial = await historyService.getUserHistorial(from);
        if (historial) {
            data.nombre = historial.nombre;
            data.historialExists = true;
        } else {
            data.historialExists = false;
        }

        const { menuMsg, menuPrincipal, paraPicar, menuPrincipalCount } = await menuService.buildFullMenu();

        data.menuPrincipal = menuPrincipal;
        data.paraPicar = paraPicar;
        data.menuPrincipalCount = menuPrincipalCount;
        data.menuMsg = menuMsg;

        await client.sendMessage(from, menuMsg);

    } else if (body === "2") {
        // --- Enviar Ubicación ---
        await client.sendMessage(from, "📍 Estamos ubicados en:\nCalle 123 #45-67, Viterbo, Caldas.\n¡Te esperamos! 🫶");
        await client.sendMessage(from, "https://www.google.com/maps/@5.0679782,-75.8666766,18z?entry=ttu&g_ep=EgoyMDI1MDYxNy4wIKXMDSoASAFQAw%3D%3D");
        conv.resetConversation(from);
    } else if (body === "3") {
        // --- Consultar Estado ---
        await client.sendMessage(from, "🚚 Para revisar tu pedido, solo necesito tu *número de orden*. ¡Gracias!");
        conv.setConversationState(from, "consulta_estado");
    } else {
        await client.sendMessage(from, "⚠️ Por favor, selecciona una opción válida: *1*, *2* o *3*.");
    }
}

async function handleConsultaEstado(from, body, client) {
    const orderCode = body.toUpperCase().replace(/\s/g, "");
    if (!/^[A-Z]{3}-\d{3}$/.test(orderCode)) {
        await client.sendMessage(from, "🔎 Necesito un número de orden válido en el formato: *_ABC-123_*. ¡Gracias!");
        return;
    }

    const info = await orderService.getOrderFullInfo(orderCode);
    if (!info) {
        await client.sendMessage(from, "😕 No pudimos encontrar tu orden. Revisa el número y vuelve a intentarlo.");
    } else {
        let msgEstado = `📦 *Estado de tu pedido ${info["# ORDEN"]}:* ${info["ESTADO DE ORDEN"]}\n\n` +
            `🗓️ *Fecha:* ${info.FECHA}\n` +
            `⏰ *Hora:* ${info.HORA}\n` +
            `📍 *Dirección:* ${info["DIRECCION DE LA ORDEN"]}\n` +
            `💳 *Método de pago:* ${info["METODO DE PAGO"]}\n` +
            `💰 *Total:* ${formatPrice(info["PRECIO TOTAL"])}\n\n` +
            `📝 *Detalle del pedido:*\n${info["ITEMS DE LA ORDEN"]}`;
        await client.sendMessage(from, msgEstado);
    }
    conv.resetConversation(from);
}

async function handleMenu(from, body, client) {
    const data = conv.getUserData(from);
    if (body === "0") {
        await client.sendMessage(from, "🛑 Pedido cancelado. Si deseas hacer uno nuevo, solo envíanos un mensaje.");
        conv.resetConversation(from);
        return;
    }

    const idx = parseInt(body) - 1;
    const totalOpciones = (data.menuPrincipal?.length || 0) + (data.paraPicar?.length || 0);
    if (isNaN(idx) || idx < 0 || idx >= totalOpciones) {
        await client.sendMessage(from, "⚠️ Opción inválida. Por favor, selecciona un número del menú.");
        return;
    }

    if (idx < data.menuPrincipalCount) {
        data.selectedItem = data.menuPrincipal[idx];
        conv.setConversationState(from, "cantidad_menu");
        await client.sendMessage(from, `✅ Perfecto, ¿cuántas unidades de ${data.selectedItem.name} te gustaría ordenar?`);
    } else {
        const paraPicarIdx = idx - data.menuPrincipalCount;
        data.selectedParaPicar = data.paraPicar[paraPicarIdx];
        conv.setConversationState(from, "cantidad_para_picar");
        await client.sendMessage(from, `😋 ¿Cuántas unidades de ${data.selectedParaPicar.name} te gustaría pedir?`);
    }
}

async function handleCantidad(from, body, client, itemType) {
    const data = conv.getUserData(from);
    const qty = parseInt(body);
    if (isNaN(qty) || qty <= 0) {
        await client.sendMessage(from, "⚠️ Por favor, ingresa una cantidad válida (un número mayor a 0).");
        return;
    }

    const item = data[itemType];
    data.cart.push({ name: item.name, price: item.price, qty, type: itemType });
    data[itemType] = null;

    conv.setConversationState(from, "agregar_mas");
    await client.sendMessage(from, "🍽️ ¿Deseas ordenar algo más de nuestro menú?\n*1.* Sí\n*2.* No");
}

async function handleAgregarMas(from, body, client) {
    const data = conv.getUserData(from);
    if (body === "1") {
        conv.setConversationState(from, "menu");
        await client.sendMessage(from, data.menuMsg || "Aquí está nuestro menú:");
    } else if (body === "2") {
        conv.setConversationState(from, "ofrecer_bebidas");
        await client.sendMessage(from, "🥤 ¿Te gustaría acompañar tu pedido con alguna _*bebida*_?\n*1.* Sí\n*2.* No");
    } else {
        await client.sendMessage(from, "⚠️ Por favor responde solo con *1* (Sí) o *2* (No).");
    }
}

async function handleOfrecerBebidas(from, body, client) {
    if (body === "1") {
        const bebidas = await menuService.getDrinksMenu();
        if (!bebidas) {
            await client.sendMessage(from, "No se encontró el menú de bebidas.");
            await showResumen(from, client);
            return;
        }
        const data = conv.getUserData(from);
        data.bebidas = bebidas;
        let bebidasMsg = "🥤 Estas son nuestras bebidas:\n";
        data.bebidas.forEach((item, i) => { bebidasMsg += `*${i + 1}.* ${item.name} - ${formatPrice(item.price)}\n`; });
        bebidasMsg += "\n*0.* No añadir bebidas";
        conv.setConversationState(from, "bebidas");
        await client.sendMessage(from, bebidasMsg);
    } else if (body === "2") {
        await showResumen(from, client);
    } else {
        await client.sendMessage(from, "⚠️ Por favor responde solo con *1* (Sí) o *2* (No).");
    }
}

async function handleBebidas(from, body, client) {
    const data = conv.getUserData(from);
    if (body === "0") {
        await showResumen(from, client);
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
    conv.setConversationState(from, "cantidad_bebida");
    await client.sendMessage(from, `¿Cuántas unidades de *${data.selectedBebida.name}* deseas?`);
}

async function handleCantidadBebida(from, body, client) {
    const data = conv.getUserData(from);
    const qty = parseInt(body);
    if (isNaN(qty) || qty <= 0) {
        await client.sendMessage(from, "⚠️ Por favor, ingresa una cantidad válida.");
        return;
    }
    data.cart.push({ name: data.selectedBebida.name, price: data.selectedBebida.price, qty, type: 'bebida' });
    data.selectedBebida = null;
    conv.setConversationState(from, "agregar_bebida");
    await client.sendMessage(from, "🥤 ¿Deseas añadir otra bebida?\n*1.* Sí\n*2.* No");
}

async function handleAgregarBebida(from, body, client) {
    const data = conv.getUserData(from);
    if (body === '1') {
        let bebidasMsg = "🥤 Estas son nuestras bebidas:\n";
        data.bebidas.forEach((item, i) => { bebidasMsg += `*${i + 1}.* ${item.name} - ${formatPrice(item.price)}\n`; });
        bebidasMsg += "\n*0.* No añadir más bebidas";
        conv.setConversationState(from, "bebidas");
        await client.sendMessage(from, bebidasMsg);
    } else if (body === '2') {
        await showResumen(from, client);
    } else {
        await client.sendMessage(from, "⚠️ Por favor responde solo con *1* (Sí) o *2* (No).");
    }
}

async function showResumen(from, client, withInstructions = true) {
    const data = conv.getUserData(from);
    const { lines, total } = getCartSummary(data.cart);
    let resumen = "✅ ¡Listo! ✨ Aquí tienes el *resumen de tu pedido*:\n\n" +
        (lines.length > 0 ? lines.join("\n") : "") +
        `\n\n💰 *TOTAL:* ${formatPrice(total)}`;

    if (withInstructions && data.instrucciones) {
        resumen += `\n\n📝 *Instrucciones:* "${data.instrucciones}"`;
    }

    if (data.cart.length > 0) {
        resumen += "\n\n¿Qué deseas hacer?\n\n" +
            "*1.* Modificar mi pedido ✏️\n" +
            "*2.* Añadir instrucciones especiales 📝\n" +
            "*3.* Agregar algo más\n" +
            "*4.* Confirmar y continuar ✅";
    } else {
        resumen += "\n\n¿Qué deseas hacer?\n\n" +
            "*1.* Modificar mi pedido ✏️\n" +
            "*2.* Añadir instrucciones especiales 📝\n" +
            "*3.* Confirmar y continuar ✅";
    }

    conv.setConversationState(from, "resumen");
    await client.sendMessage(from, resumen);
}

async function handleResumen(from, body, client) {
    const data = conv.getUserData(from);
    if (data.cart.length > 0) {
        if (body === "1") {
            let modMsg = "✏️ ¿Qué ítem deseas modificar?\n";
            data.cart.forEach((item, i) => { modMsg += `*${i + 1}.* ${item.qty}x ${item.name}\n`; });
            modMsg += "\n*0.* Cancelar";
            conv.setConversationState(from, "modificar");
            await client.sendMessage(from, modMsg);
        } else if (body === "2") {
            conv.setConversationState(from, "instrucciones");
            await client.sendMessage(from, "✍️ Escribe las instrucciones para tu pedido (ej: sin cebolla, extra queso).");
        } else if (body === "3") {
            // "Agregar algo más"
            conv.setConversationState(from, "menu");
            await client.sendMessage(from, data.menuMsg);
        } else if (body === "4") {
            if (data.historialExists && data.nombre) {
                conv.setConversationState(from, "direccion");
                await client.sendMessage(from, `🏡 ¡Perfecto, *${data.nombre}*! Por favor, indícame la dirección completa para la entrega.`);
            } else {
                conv.setConversationState(from, "nombre");
                await client.sendMessage(from, "🧾 Para finalizar, ¿a nombre de quién registramos el pedido?");
            }
        } else {
            await client.sendMessage(from, "⚠️ Por favor selecciona una opción válida (1, 2, 3 o 4).");
        }
    } else {
        // Cart is empty
        await client.sendMessage(from, "Tu carrito está vacío. Te enviaré al menú principal para que puedas agregar productos.");
        conv.setConversationState(from, "menu");
        if (!data.menuMsg) {
            const { menuMsg, menuPrincipal, paraPicar, menuPrincipalCount } = await menuService.buildFullMenu();
            data.menuMsg = menuMsg;
            data.menuPrincipal = menuPrincipal;
            data.paraPicar = paraPicar;
            data.menuPrincipalCount = menuPrincipalCount;
        }
        await client.sendMessage(from, data.menuMsg);
    }
}

async function handleInstrucciones(from, body, client) {
    const data = conv.getUserData(from);
    data.instrucciones = body || "";
    await showResumen(from, client);
}

async function handleModificar(from, body, client) {
    const data = conv.getUserData(from);
    const idx = parseInt(body) - 1;
    if (body === "0") {
        await showResumen(from, client);
        return;
    }
    if (isNaN(idx) || idx < 0 || idx >= data.cart.length) {
        await client.sendMessage(from, "⚠️ Opción inválida.");
        return;
    }
    data.modificarIdx = idx;
    conv.setConversationState(from, "modificar_accion");
    await client.sendMessage(from, `🔧 Para ${data.cart[idx].qty}x ${data.cart[idx].name}, elige:\n*1.* Cambiar cantidad\n*2.* Quitar del pedido\n*0.* Cancelar`);
}

async function handleModificarAccion(from, body, client) {
    const data = conv.getUserData(from);
    const idx = data.modificarIdx;
    if (body === "0") {
        await showResumen(from, client);
        return;
    }
    if (body === "1") {
        conv.setConversationState(from, "modificar_cantidad");
        await client.sendMessage(from, `¿Cuál es la nueva cantidad para *${data.cart[idx].name}*?`);
    } else if (body === "2") {
        data.cart.splice(idx, 1);
        delete data.modificarIdx;
        await showResumen(from, client);
    } else {
        await client.sendMessage(from, "⚠️ Opción inválida.");
    }
}

async function handleModificarCantidad(from, body, client) {
    const data = conv.getUserData(from);
    const idx = data.modificarIdx;
    const qty = parseInt(body);
    if (isNaN(qty) || qty <= 0) {
        await client.sendMessage(from, "⚠️ Por favor, ingresa una cantidad válida.");
        return;
    }
    data.cart[idx].qty = qty;
    delete data.modificarIdx;
    await showResumen(from, client);
}

async function handleNombre(from, body, client) {
    const data = conv.getUserData(from);
    data.nombre = body;
    conv.setConversationState(from, "direccion");
    await client.sendMessage(from, `🏡 ¡Perfecto, *${data.nombre}*! Ahora, indícame la dirección completa.`);
}

async function handleDireccion(from, body, client) {
    const data = conv.getUserData(from);
    data.direccion = body;
    conv.setConversationState(from, "metodo_pago");
    await client.sendMessage(from, "💳 ¿Cómo deseas pagar?\n*1.* Efectivo 💵\n*2.* Nequi 📲\n*3.* Daviplata 📲");
}

async function handleMetodoPago(from, body, client) {
    const data = conv.getUserData(from);
    let metodo = "";
    if (body === "1") metodo = "Efectivo";
    else if (body === "2") metodo = "Nequi";
    else if (body === "3") metodo = "Daviplata";
    else {
        await client.sendMessage(from, "⚠️ Por favor selecciona una opción válida.");
        return;
    }
    data.metodoPago = metodo;

    if (metodo === "Nequi") {
        conv.setConversationState(from, "nequi_pago");
        // --- MENSAJE CORREGIDO ---
        await client.sendMessage(from, `Has elegido Nequi. Por favor, realiza el pago a nuestra línea *${process.env.PAY_NUMBER}*.\n\nUna vez hecho, por favor *escribe el número de teléfono (10 dígitos) desde el que realizaste el pago* para poder asociarlo a tu pedido.`);
    } else if (metodo === "Efectivo") {
        conv.setConversationState(from, "paga_con");
        await client.sendMessage(from, "💵 ¿Con cuánto vas a pagar? (Ej: 50000)");
    } else {
        data.pagaCon = null;
        data.cambio = null;
        await handleConfirmacion(from, client);
    }
}
async function handleNequiPago(from, body, client) {
    const data = conv.getUserData(from);
    const nequiAttempts = (data.nequiAttempts || 0) + 1;

    if (!/^\d{10}$/.test(body)) {
        if (nequiAttempts >= 3) {
            conv.resetConversation(from);
            await client.sendMessage(from, "Parece que hay problemas con el número. Para continuar, por favor regresa al menú principal enviando un mensaje.");
        } else {
            data.nequiAttempts = nequiAttempts;
            await client.sendMessage(from, `El número de teléfono debe tener 10 dígitos. Por favor, inténtalo de nuevo (intentos restantes: ${3 - nequiAttempts}).`);
        }
        return;
    }

    data.nequiNumber = body;
    conv.setConversationState(from, "nequi_envio_comprobante");
    await client.sendMessage(from, "Perfecto. Ahora envíame el comprobante de pago (una foto o captura de pantalla).");

    // Iniciar temporizador
    setTimeout(async () => {
        if (conv.getConversationState(from) === "nequi_envio_comprobante") {
            await client.sendMessage(from, "¿Todo bien con el pago? Recuerda enviarme el comprobante o puedes regresar al menú principal.");
        }
    }, 3 * 60 * 1000); // 3 minutos
}

async function handleNequiEnvioComprobante(from, msg, client) {
    if (!msg.hasMedia) {
        await client.sendMessage(from, "Por favor, envía una imagen como comprobante.");
        return;
    }

    try {
        const media = await msg.downloadMedia();

        // Verificación por si la descarga falla por alguna razón
        if (!media) {
            await client.sendMessage(from, "No pude procesar el archivo que enviaste. ¿Puedes intentar enviarlo de nuevo?");
            return;
        }

        const data = conv.getUserData(from);
        const { lines, total } = getCartSummary(data.cart);

        conv.setConversationState(from, "nequi_verificacion");
        await client.sendMessage(from, "Recibí tu comprobante en alta calidad. ¡Un momento mientras lo verifico!");

        // Guardar la información para el log del admin
        const verificationId = await adminService.logPaymentForVerification({
            clientNumber: from,
            clientName: data.nombre,
            orderItems: lines.join(', '),
            amount: total,
            paymentMethod: 'Nequi',
            timestamp: new Date().toISOString()
        });
        
        const adminNumber = process.env.ADMIN_WHATSAPP_NUMBER;
        
        // Construimos el texto que irá como pie de foto (caption)
        const caption = `📌 *Nuevo Pago Nequi por Verificar*\n\n` +
                      `• *Cliente:* ${data.nombre} (${from.replace(/@c.us/g, '')})\n` +
                      `• *Pedido:* ${lines.join(', ')}\n` +
                      `• *Monto:* ${formatPrice(total)}`;

        // Enviamos la imagen en alta calidad (media) con su texto (caption)
        await client.sendMessage(adminNumber, media, { caption: caption });
        
        // Enviamos las opciones de respuesta al admin por separado
        await client.sendMessage(adminNumber, `ID de Verificación: ${verificationId}\n\n➡️ *Opciones:*\n1. Confirmar\n2. Denegar`);

        // Lógica del temporizador (sin cambios)
        setTimeout(async () => {
            const isPending = await adminService.isVerificationPending(verificationId);
            if (isPending) {
                await client.sendMessage(from, "El administrador está tardando un poco en verificar tu pago. Te notificaré tan pronto como haya una respuesta.");
            }
        }, 5 * 60 * 1000);

    } catch (e) {
        console.error("Error al descargar o procesar el comprobante:", e);
        await client.sendMessage(from, "Hubo un problema al procesar tu comprobante. Por favor, intenta enviarlo de nuevo.");
    }
}
async function handlePagoDenegado(from, body, client) {
    if (body === "1") {
        conv.setConversationState(from, "nequi_envio_comprobante");
        await client.sendMessage(from, "Por favor, reenvía el comprobante de pago.");
    } else if (body === "2") {
        conv.resetConversation(from);
        await client.sendMessage(from, "Has vuelto al menú principal. Envía un mensaje para comenzar.");
    } else if (body === "3") {
        conv.setConversationState(from, "hablar_con_agente");
        await client.sendMessage(from, "Un momento, te comunicaré con un agente.");
        // Lógica para notificar al agente
    } else {
        await client.sendMessage(from, "Por favor, elige una de las opciones: 1, 2 o 3.");
    }
}

async function handlePagaCon(from, body, client) {
    const data = conv.getUserData(from);
    const { total } = getCartSummary(data.cart);
    const pagaCon = parseInt(body.replace(/\D/g, ""));

    if (isNaN(pagaCon) || pagaCon < total) {
        await client.sendMessage(from, `⚠️ Por favor, ingresa un valor mayor o igual al total (${formatPrice(total)}).`);
        return;
    }
    data.pagaCon = pagaCon;
    data.cambio = pagaCon - total;
    await handleConfirmacion(from, client);
}

async function handleConfirmacion(from, client) {
    const data = conv.getUserData(from);
    const { lines, total } = getCartSummary(data.cart);
    const orderCode = await orderService.generateUniqueOrderCode();
    data.orderCode = orderCode;
    const tiempoEntrega = getDeliveryTime();

    let resumen = `🎉 *¡Tu pedido ha sido confirmado!* 🎉\n\n` +
        `📦 *Orden:* ${orderCode}\n` +
        `🙋‍♂️ *Cliente:* ${data.nombre}\n` +
        `📍 *Dirección:* ${data.direccion}\n\n` +
        `🧾 *Detalle del pedido:*\n` + lines.join("\n") + "\n";

    if (data.instrucciones) resumen += `\n📝 *Instrucciones:* "${data.instrucciones}"\n`;

    resumen += `\n💰 *Total a pagar:* ${formatPrice(total)}\n` +
        `💳 *Método de pago:* ${data.metodoPago}`;

    if (data.metodoPago === "Efectivo" && data.pagaCon) {
        resumen += `\n💵 Pagas con: ${formatPrice(data.pagaCon)}\n` +
            `🔁 Cambio: ${formatPrice(data.cambio)}`;
    }

    resumen += `\n\n⏱️ Tu orden llegará en aprox. *${tiempoEntrega} minutos*.\n` +
        `¡Gracias por elegirnos! 🧡`;

    await client.sendMessage(from, resumen);

    try {
        const stickerPath = path.join(__dirname, "..", "sticker.webp");
        if (fs.existsSync(stickerPath)) {
            const stickerMedia = MessageMedia.fromFilePath(stickerPath);
            await client.sendMessage(from, stickerMedia, { sendMediaAsSticker: true });
        }
    } catch (e) { console.error("No se pudo enviar el sticker:", e); }

    let adminMsg = `🚨 *NUEVO PEDIDO* 🚨\n\n` +
        `📦 *Orden:* ${orderCode}\n` +
        `🙋‍♂️ *Cliente:* ${data.nombre}\n` +
        `📍 *Dirección:* ${data.direccion}\n\n` +
        `🧾 *Detalle:*\n` + lines.join("\n") + "\n";

    if (data.instrucciones) adminMsg += `\n📝 *Instrucciones:* "${data.instrucciones}"\n`;
    adminMsg += `\n💰 *TOTAL:* ${formatPrice(total)}\n` +
        `💳 *PAGO:* ${data.metodoPago}\n`;

    await client.sendMessage(process.env.ADMIN_WHATSAPP_NUMBER, adminMsg);

    const itemsString = lines.join("\n") + (data.instrucciones ? `\nInstrucciones: ${data.instrucciones}` : "");
    await orderService.saveOrderState({
        orderCode, from, nombre: data.nombre, direccion: data.direccion, items: itemsString, metodoPago: data.metodoPago, total
    });

    await historyService.updateUserHistorial(from, data.nombre);
    conv.resetConversation(from);
}

// --- Exportación de Manejadores ---

module.exports = {
    inicio: handleInicio,
    consulta_estado: handleConsultaEstado,
    menu: handleMenu,
    cantidad_menu: (from, body, client) => handleCantidad(from, body, client, 'selectedItem'),
    cantidad_para_picar: (from, body, client) => handleCantidad(from, body, client, 'selectedParaPicar'),
    agregar_mas: handleAgregarMas,
    ofrecer_bebidas: handleOfrecerBebidas,
    bebidas: handleBebidas,
    cantidad_bebida: handleCantidadBebida,
    agregar_bebida: handleAgregarBebida,
    resumen: handleResumen,
    instrucciones: handleInstrucciones,
    modificar: handleModificar,
    modificar_accion: handleModificarAccion,
    modificar_cantidad: handleModificarCantidad,
    nombre: handleNombre,
    direccion: handleDireccion,
    metodo_pago: handleMetodoPago,
    nequi_pago: handleNequiPago,
    nequi_envio_comprobante: handleNequiEnvioComprobante,
    pago_denegado: handlePagoDenegado,
    paga_con: handlePagaCon,
    confirmacion: handleConfirmacion
};