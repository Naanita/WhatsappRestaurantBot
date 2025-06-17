require("dotenv").config();
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const fs = require("fs");
const ExcelJS = require("exceljs");
const creds = require("./credentials.json");

const GOOGLE_SHEET_INFO_ID = "1ZsCxMOkfL1Zlo18jPMSHukuzFA1KrKYTeTauOsPWNP8";

const client = new Client({
  puppeteer: { headless: true, args: ["--no-sandbox"] },
  authStrategy: new LocalAuth({ clientId: "bot2" }),
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
const timeouts = {};
const messageCounters = {}; // Nuevo: contador de mensajes por usuario
const adminNumbers = [
  "573148147148@c.us", // ADMIN1
  "573148147148@c.us", // ADMIN2
];

const regionAdminMap = {
  andina: 0,
  bogota: 0,
  medellin: 0,
  cali: 1,
  "eje cafetero": 1,
  costa: 1,
  santander: 1,
};

const regiones = [
  "1. Andina",
  "2. Bogotá",
  "3. Cali",
  "4. Eje Cafetero",
  "5. Costa",
  "6. Medellín",
  "7. Santander",
];

client.on("qr", (qr) => qrcode.generate(qr, { small: true }));
client.on("ready", () => console.log("Client is ready!"));
client.on("authenticated", () => console.log("Client is authenticated!"));
client.on("auth_failure", (msg) =>
  console.error("Authentication failure", msg)
);

function clearTimeouts(from) {
  if (timeouts[from]) {
    clearTimeout(timeouts[from].recordatorio);
    clearTimeout(timeouts[from].finalizacion);
    delete timeouts[from];
  }
}

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

// Nueva función: guarda una fila por conversación
async function registrarConversacion(numero, cantidadMensajes) {
  try {
    const serviceAccountAuth = getServiceAccountAuth();
    const doc = new GoogleSpreadsheet(GOOGLE_SHEET_INFO_ID, serviceAccountAuth);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    await sheet.loadHeaderRow();

    const ahora = new Date();
    const fechaHora =
      ahora.getFullYear() +
      "-" +
      String(ahora.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(ahora.getDate()).padStart(2, "0") +
      " " +
      String(ahora.getHours()).padStart(2, "0") +
      ":" +
      String(ahora.getMinutes()).padStart(2, "0");

    await sheet.addRow({
      Numero: numero,
      "Intentos hasta la solución": cantidadMensajes,
      "Horas de Inicio": fechaHora,
    });
  } catch (error) {
    console.error("Error guardando conversación:", error);
  }
}

async function buscarEnGoogleSheets(nit, codigo = null) {
  try {
    const serviceAccountAuth = getServiceAccountAuth();
    const doc = new GoogleSpreadsheet(
      process.env.GOOGLE_SHEET_ID,
      serviceAccountAuth
    );
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();

    const filasNit = rows.filter((row) => {
      const rowNit = row._rawData[0] ? row._rawData[0].toString().trim() : "";
      return rowNit === nit.toString().trim();
    });

    if (filasNit.length === 0) {
      return null;
    }

    if (!codigo) {
      const rowNombre = filasNit[0]._rawData[2]
        ? filasNit[0]._rawData[2].toString().trim()
        : "";
      return { nombre: rowNombre };
    }

    const filaCodigo = filasNit.find((row) => {
      const rowCodigo = row._rawData[1]
        ? row._rawData[1].toString().trim()
        : "";
      return rowCodigo === codigo.toString().trim();
    });

    if (!filaCodigo) {
      return null;
    }

    const rowNombre = filaCodigo._rawData[2]
      ? filaCodigo._rawData[2].toString().trim()
      : "";
    return { nombre: rowNombre };
  } catch (error) {
    console.error("Error buscando en Google Sheets:", error);
    throw new Error("No se pudo conectar con la hoja de cálculo.");
  }
}

async function enviarEstadoCuentaPersonalizado(from, nit, codigo) {
  try {
    const serviceAccountAuth = getServiceAccountAuth();
    const doc = new GoogleSpreadsheet(
      process.env.GOOGLE_SHEET_ID,
      serviceAccountAuth
    );
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();

    const datosFiltrados = rows.filter(
      (row) =>
        (row._rawData[0] ? row._rawData[0].toString().trim() : "") ===
          nit.toString().trim() &&
        (row._rawData[1] ? row._rawData[1].toString().trim() : "") ===
          codigo.toString().trim()
    );

    if (datosFiltrados.length === 0) {
      await client.sendMessage(
        from,
        "No se encontraron datos para tu NIT y código."
      );
      return;
    }

    let nombre = datosFiltrados[0]._rawData[2] || "usuario";
    nombre = nombre.replace(/[^a-zA-Z0-9_\-]/g, "_");

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Estado de Cuenta");

    const headers = [
      "Name 1",
      "Invoice number",
      "CO E-Invoice No.",
      "Outstanding balance",
      "Billing Date",
      "Due date",
      "Days overdue",
    ];
    worksheet.addRow(headers);

    worksheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "d01e26" },
      };
      cell.alignment = {
        vertical: "middle",
        horizontal: "center",
        wrapText: true,
      };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    datosFiltrados.forEach((row) => {
      worksheet.addRow([
        row._rawData[2] || "",
        row._rawData[3] || "",
        row._rawData[4] || "",
        row._rawData[9] || "",
        row._rawData[10] || "",
        row._rawData[11] || "",
        row._rawData[12] || "",
      ]);
    });

    worksheet.columns.forEach((column) => {
      let maxLength = 0;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const cellValue = cell.value ? cell.value.toString() : "";
        maxLength = Math.max(maxLength, cellValue.length);
      });
      column.width = maxLength < 15 ? 15 : maxLength + 2;
    });

    const filePath = `./estado_cuenta_${nombre}.xlsx`;
    await workbook.xlsx.writeFile(filePath);

    const fileBuffer = fs.readFileSync(filePath);
    const media = new MessageMedia(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileBuffer.toString("base64"),
      `estado_cuenta_${nombre}.xlsx`
    );

    await client.sendMessage(from, media, {
      caption: "*Aquí tienes tu estado de cuenta!*",
    });

    fs.unlinkSync(filePath);
  } catch (error) {
    console.error("Error enviando estado de cuenta:", error);
    await client.sendMessage(
      from,
      "Ocurrió un error generando o enviando tu estado de cuenta. Intenta más tarde."
    );
  }
}

client.on("message", async (msg) => {
  const from = msg.from;
  const body = msg.body.trim();
  const numero = from.replace(/@c\.us$/, "");

  // Nuevo: contar mensajes por usuario
  if (!messageCounters[from]) messageCounters[from] = 0;
  messageCounters[from]++;

  // Solo inicia el flujo si no está activo
  if (!conversationStates[from] || conversationStates[from] === "ended") {
    conversationStates[from] = "menu_inicial";
    clearTimeouts(from);
    try {
      const media = MessageMedia.fromFilePath("./HIKSTATEMENT.png");
      await client.sendMessage(from, media, {
        caption: "¡Hola! 👋 Soy *HikStatement*.",
      });
    } catch (e) {
      console.error("No se pudo enviar la imagen de bienvenida:", e);
      await client.sendMessage(from, "¡Hola! 👋 Soy *HikStatement*.");
    }
    await client.sendMessage(
      from,
      "*¿Qué quieres hacer?*\n\n*1.* Descargar estado de cuenta.\n*2.* Otra solicitud"
    );
    timeouts[from] = {
      recordatorio: setTimeout(async () => {
        if (conversationStates[from] === "menu_inicial") {
          await client.sendMessage(from, "¿Estás ahí?");
          timeouts[from].finalizacion = setTimeout(async () => {
            if (conversationStates[from] === "menu_inicial") {
              await client.sendMessage(
                from,
                "Chat finalizado por inactividad. Escribe cualquier mensaje para iniciar de nuevo."
              );
              conversationStates[from] = "ended";
              clearTimeouts(from);
              // Guardar conversación al finalizar
              await registrarConversacion(numero, messageCounters[from]);
              delete messageCounters[from];
            }
          }, 2400000);
        }
      }, 2400000),
    };
    if (!userData[from]) userData[from] = {};
    return;
  }

  try {
    // Menú inicial con opciones
    if (conversationStates[from] === "menu_inicial") {
      clearTimeouts(from);
      if (body === "1") {
        conversationStates[from] = "esperando_nit";
        await client.sendMessage(from, "Por favor, digita tu número de *NIT*");
        timeouts[from] = {
          recordatorio: setTimeout(async () => {
            if (conversationStates[from] === "esperando_nit") {
              await client.sendMessage(from, "¿Estás ahí?");
              timeouts[from].finalizacion = setTimeout(async () => {
                if (conversationStates[from] === "esperando_nit") {
                  await client.sendMessage(
                    from,
                    "Chat finalizado por inactividad. Escribe cualquier mensaje para iniciar de nuevo."
                  );
                  conversationStates[from] = "ended";
                  clearTimeouts(from);
                  await registrarConversacion(numero, messageCounters[from]);
                  delete messageCounters[from];
                }
              }, 2400000);
            }
          }, 2400000),
        };
      } else if (body === "2") {
        conversationStates[from] = "seleccionando_region";
        const mensajeRegiones =
          "*Por favor, elige la región donde te encuentras:*\n\n" +
          regiones.join("\n");
        await client.sendMessage(from, mensajeRegiones);
        timeouts[from] = {
          recordatorio: setTimeout(async () => {
            if (conversationStates[from] === "seleccionando_region") {
              await client.sendMessage(from, "¿Estás ahí?");
              timeouts[from].finalizacion = setTimeout(async () => {
                if (conversationStates[from] === "seleccionando_region") {
                  await client.sendMessage(
                    from,
                    "Chat finalizado por inactividad. Escribe cualquier mensaje para iniciar de nuevo."
                  );
                  conversationStates[from] = "ended";
                  clearTimeouts(from);
                  await registrarConversacion(numero, messageCounters[from]);
                  delete messageCounters[from];
                }
              }, 2400000);
            }
          }, 2400000),
        };
      } else {
        await client.sendMessage(
          from,
          "Opción no válida. Por favor, responde con *1* para descargar el estado de cuenta o *2* para otra solicitud."
        );
      }
      return;
    }

    // Selección de región
    if (conversationStates[from] === "seleccionando_region") {
      clearTimeouts(from);
      const opcion = parseInt(body);
      if (opcion >= 1 && opcion <= 7) {
        const regionesNombres = [
          "andina",
          "bogota",
          "cali",
          "eje cafetero",
          "costa",
          "medellin",
          "santander",
        ];
        const regionSeleccionada = regionesNombres[opcion - 1];
        userData[from].region = regionSeleccionada;
        if (
          userData[from].nit &&
          userData[from].codigo &&
          userData[from].nombre
        ) {
          conversationStates[from] = "esperando_solicitud";
          await client.sendMessage(from, "Por favor, escribe tu solicitud:");
        } else {
          conversationStates[from] = "esperando_nit_solicitud";
          await client.sendMessage(
            from,
            "Por favor, digita tu número de *NIT*"
          );
        }
      } else {
        await client.sendMessage(
          from,
          "Opción no válida. Por favor, selecciona un número del 1 al 7."
        );
      }
      return;
    }

    // Esperando NIT para solicitud (opción 2)
    if (conversationStates[from] === "esperando_nit_solicitud") {
      clearTimeouts(from);
      const nit = body;
      let resultado;
      try {
        resultado = await buscarEnGoogleSheets(nit);
      } catch (error) {
        await client.sendMessage(
          from,
          error.message || "Ocurrió un error buscando tu NIT."
        );
        conversationStates[from] = "ended";
        await registrarConversacion(numero, messageCounters[from]);
        delete messageCounters[from];
        return;
      }
      if (resultado) {
        userData[from].nit = nit;
        userData[from].nombre = resultado.nombre;
        conversationStates[from] = "esperando_codigo_solicitud";
        await client.sendMessage(
          from,
          `¡Hola, *${resultado.nombre}*! Por favor, ingresa tu *código de cliente*`
        );
      } else {
        await client.sendMessage(
          from,
          "NIT no encontrado o no autorizado. Intenta de nuevo o escribe cualquier mensaje para reiniciar."
        );
        conversationStates[from] = "ended";
        await registrarConversacion(numero, messageCounters[from]);
        delete messageCounters[from];
      }
      return;
    }

    // Esperando código de cliente para solicitud (opción 2)
    if (conversationStates[from] === "esperando_codigo_solicitud") {
      clearTimeouts(from);
      const codigo = body;
      const nit = userData[from]?.nit;
      let resultado;
      try {
        resultado = await buscarEnGoogleSheets(nit, codigo);
      } catch (error) {
        await client.sendMessage(
          from,
          error.message || "Ocurrió un error validando tu código."
        );
        conversationStates[from] = "ended";
        await registrarConversacion(numero, messageCounters[from]);
        delete messageCounters[from];
        return;
      }
      if (resultado) {
        userData[from].codigo = codigo;
        userData[from].nombre = resultado.nombre;
        conversationStates[from] = "esperando_solicitud";
        await client.sendMessage(from, "Por favor, escribe tu solicitud:");
      } else {
        await client.sendMessage(
          from,
          "Código incorrecto. Intenta de nuevo o escribe cualquier mensaje para reiniciar."
        );
        conversationStates[from] = "ended";
        await registrarConversacion(numero, messageCounters[from]);
        delete messageCounters[from];
      }
      return;
    }

    // Esperando NIT para estado de cuenta
    if (conversationStates[from] === "esperando_nit") {
      clearTimeouts(from);
      const nit = body;
      let resultado;
      try {
        resultado = await buscarEnGoogleSheets(nit);
      } catch (error) {
        await client.sendMessage(
          from,
          error.message || "Ocurrió un error buscando tu NIT."
        );
        conversationStates[from] = "ended";
        await registrarConversacion(numero, messageCounters[from]);
        delete messageCounters[from];
        return;
      }
      if (resultado) {
        userData[from].nit = nit;
        userData[from].nombre = resultado.nombre;
        conversationStates[from] = "esperando_codigo";
        await client.sendMessage(
          from,
          `¡Hola, *${resultado.nombre}!* Por favor, ingresa tu *código de cliente*`
        );
        timeouts[from] = {
          recordatorio: setTimeout(async () => {
            if (conversationStates[from] === "esperando_codigo") {
              await client.sendMessage(from, "¿Estás ahí?");
              timeouts[from].finalizacion = setTimeout(async () => {
                if (conversationStates[from] === "esperando_codigo") {
                  await client.sendMessage(
                    from,
                    "Chat finalizado por inactividad. Escribe cualquier mensaje para iniciar de nuevo."
                  );
                  conversationStates[from] = "ended";
                  clearTimeouts(from);
                  await registrarConversacion(numero, messageCounters[from]);
                  delete messageCounters[from];
                }
              }, 2400000);
            }
          }, 2400000),
        };
      } else {
        await client.sendMessage(
          from,
          "NIT no encontrado o no autorizado. Intenta de nuevo o escribe cualquier mensaje para reiniciar."
        );
        conversationStates[from] = "ended";
        await registrarConversacion(numero, messageCounters[from]);
        delete messageCounters[from];
      }
      return;
    }

    // Esperando código de verificación para estado de cuenta
    if (conversationStates[from] === "esperando_codigo") {
      clearTimeouts(from);
      const codigo = body;
      const nit = userData[from]?.nit;
      let resultado;
      try {
        resultado = await buscarEnGoogleSheets(nit, codigo);
      } catch (error) {
        await client.sendMessage(
          from,
          error.message || "Ocurrió un error validando tu código."
        );
        conversationStates[from] = "ended";
        await registrarConversacion(numero, messageCounters[from]);
        delete messageCounters[from];
        return;
      }
      if (resultado) {
        userData[from].codigo = codigo;
        userData[from].nombre = resultado.nombre;
        await enviarEstadoCuentaPersonalizado(
          from,
          userData[from].nit,
          userData[from].codigo
        );
        conversationStates[from] = "menu_post_estado";
        await client.sendMessage(
          from,
          "*¿Deseas realizar otra solicitud?*\n\n*1.* Sí, otra solicitud\n*2.* Terminar chat"
        );
      } else {
        await client.sendMessage(
          from,
          "Código incorrecto. Intenta de nuevo o escribe cualquier mensaje para reiniciar."
        );
        conversationStates[from] = "ended";
        await registrarConversacion(numero, messageCounters[from]);
        delete messageCounters[from];
      }
      return;
    }

    // Menú después de entregar estado de cuenta
    if (conversationStates[from] === "menu_post_estado") {
      clearTimeouts(from);
      if (body === "1") {
        conversationStates[from] = "seleccionando_region";
        const mensajeRegiones =
          "*Por favor, elige la región donde te encuentras:*\n\n" +
          regiones.join("\n");
        await client.sendMessage(from, mensajeRegiones);
      } else if (body === "2") {
        conversationStates[from] = "ended";
        await client.sendMessage(
          from,
          "¡Gracias por contactarnos! Si necesitas algo más, escribe cualquier mensaje para iniciar de nuevo."
        );
        await registrarConversacion(numero, messageCounters[from]);
        delete messageCounters[from];
      } else {
        await client.sendMessage(
          from,
          "Opción no válida. Responde con *1* para otra solicitud o *2* para terminar el chat."
        );
      }
      return;
    }

    // Esperando texto de solicitud (para ambas opciones)
    if (conversationStates[from] === "esperando_solicitud") {
      clearTimeouts(from);
      userData[from].solicitud = body;
      conversationStates[from] = "ended";

      const solicitud = userData[from].solicitud;
      const region = userData[from].region;
      const numero = from.replace(/@c\.us$/, "");
      let nombre = userData[from].nombre || "";
      let codigoCliente = userData[from].codigo || "";

      const resumen = `*¡Gracias!*\nPronto nos pondremos en contacto contigo.\n\n*Solicitud enviada:*\n\`\`\`\n${solicitud}\n\`\`\``;
      await client.sendMessage(from, resumen);

      // Determinar admin según región
      const adminIndex = regionAdminMap[region];
      const adminNumber = adminNumbers[adminIndex];

      // Mensaje para el admin: nombre, código de cliente, número, región y solicitud
      const mensajeAdmin = `*Nueva solicitud recibida*\n\n*Nombre:* ${nombre}\n*Código de cliente:* ${codigoCliente}\n*Número:* ${numero}\n*Región:* ${
        region ? region.charAt(0).toUpperCase() + region.slice(1) : ""
      }\n*Solicitud:*\n\`\`\`\n${solicitud}\n\`\`\``;
      await client.sendMessage(adminNumber, mensajeAdmin);

      // Enviar tarjeta de contacto del usuario al admin
      try {
        const contactCard = await msg.getContact();
        await client.sendMessage(adminNumber, contactCard, {
          caption: `*Tarjeta de contacto del usuario*`,
        });
      } catch (error) {
        console.error("Error enviando tarjeta de contacto:", error);
        await client.sendMessage(
          adminNumber,
          `*Contacto del usuario:* +${numero}`
        );
      }

      await client.sendMessage(
        from,
        "Si necesitas algo más, escribe cualquier mensaje para iniciar de nuevo."
      );
      await registrarConversacion(numero, messageCounters[from]);
      delete messageCounters[from];
      return;
    }
  } catch (error) {
    console.error("Error general en el flujo:", error);
    await client.sendMessage(
      from,
      "Ocurrió un error inesperado. Intenta de nuevo más tarde."
    );
    conversationStates[from] = "ended";
    await registrarConversacion(numero, messageCounters[from]);
    delete messageCounters[from];
  }
});

client
  .initialize()
  .then(() => console.log("Client initialized successfully"))
  .catch((err) => console.error("Error initializing client", err));

const readline = require("readline");
const sessionPath = "./.wwebjs_auth/session-bot2";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.on("line", (input) => {
  if (input.trim().toLowerCase() === "resetqr") {
    console.log("Buscando sesión en:", sessionPath);
    if (fs.existsSync(sessionPath)) {
      console.log("Eliminando sesión y reiniciando para mostrar QR...");
      fs.rmSync(sessionPath, { recursive: true, force: true });
    } else {
      console.log(
        "No se encontró la carpeta de sesión, se mostrará el QR al reiniciar."
      );
    }
    process.exit(0);
  }
});
