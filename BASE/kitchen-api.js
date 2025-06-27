// kitchen-api.js
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const creds = require("../credentials.json");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

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

async function getOrderSheet() {
  const serviceAccountAuth = getServiceAccountAuth();
  const doc = new GoogleSpreadsheet(
    process.env.ORDEN_STATE,
    serviceAccountAuth
  );
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle["ORDENES"];
  return sheet;
}

function getColombiaDateString() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Bogota" })
  ).toLocaleDateString("es-CO");
}

// Utilidad para crear y guardar una factura PDF
function crearFacturaPDF(pedido) {
  const doc = new PDFDocument();
  const fileName = `factura_${pedido.id}_${Date.now()}.pdf`;
  const filePath = path.join(__dirname, "..", fileName);
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  doc.fontSize(20).text("Factura de Pedido", { align: "center" });
  doc.moveDown();
  doc.fontSize(12);
  doc.text(`Número de Orden: ${pedido.id}`);
  doc.text(`Fecha: ${pedido.fecha}`);
  doc.text(`Hora: ${pedido.hora}`);
  if (pedido.cliente) doc.text(`Cliente: ${pedido.cliente}`);
  if (pedido.numero) doc.text(`Número: ${pedido.numero}`);
  if (pedido.direccion) doc.text(`Dirección: ${pedido.direccion}`);
  doc.text(`Estado: ${pedido.estado}`);
  if (pedido.metodo_pago) doc.text(`Método de Pago: ${pedido.metodo_pago}`);
  if (pedido.total) doc.text(`Total: ${pedido.total}`);
  doc.moveDown();
  doc.text("Detalle del pedido:");
  doc.text(pedido.detalle || "Sin detalle");
  doc.end();

  stream.on("finish", () => {
    console.log(`Factura PDF generada: ${filePath}`);
  });
}

// --- POLLING PARA DETECTAR NUEVAS FILAS ---
let lastOrderIds = new Set();

// Inicializar lastOrderIds con los IDs actuales al arrancar
async function initLastOrderIds() {
  try {
    const sheet = await getOrderSheet();
    const rows = await sheet.getRows();
    const today = getColombiaDateString();
    const todayRows = rows.filter((r) => (r._rawData[1] || "") === today);
    lastOrderIds = new Set(todayRows.map((r) => r._rawData[0]));
  } catch (e) {
    console.error("Error inicializando lastOrderIds:", e);
  }
}

// --- SSE: Notificación en tiempo real de nuevas órdenes ---
let clients = [];

app.get("/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });
  res.flushHeaders();
  clients.push(res);

  req.on("close", () => {
    clients = clients.filter((c) => c !== res);
  });
});

// Función para notificar a todos los clientes SSE
function notifyNewOrder(order) {
  const data = JSON.stringify(order);
  clients.forEach((res) => {
    res.write(`event: new-order\ndata: ${data}\n\n`);
  });
}

async function pollNewOrders() {
  try {
    const sheet = await getOrderSheet();
    const rows = await sheet.getRows();
    const today = getColombiaDateString();
    const todayRows = rows.filter((r) => (r._rawData[1] || "") === today);
    const currentIds = new Set(todayRows.map((r) => r._rawData[0]));

    // Detectar nuevas órdenes
    for (const row of todayRows) {
      if (!lastOrderIds.has(row._rawData[0])) {
        console.log("Nueva orden detectada:", row._rawData[0]);
        // Guardar timestamp para medir delay
        lastNewOrderId = row._rawData[0];
        lastNewOrderTimestamp = Date.now();
        // Enviar la información de la orden a los clientes SSE
        notifyNewOrder({
          id: row._rawData[0],
          hora: row._rawData[2] || "",
          numero: row._rawData[3] || "",
          cliente: row._rawData[4] || "",
          direccion: row._rawData[5] || "",
          detalle: row._rawData[6] || "",
          estado: row._rawData[7],
          fecha: row._rawData[1],
          metodo_pago: row._rawData[8] || "",
          total: row._rawData[9] || "",
        });
      }
    }
    lastOrderIds = currentIds;
  } catch (e) {
    console.error("Error en pollNewOrders:", e);
  }
}

// --- Para medir el tiempo entre nueva orden y GET /orders ---
let lastNewOrderId = null;
let lastNewOrderTimestamp = null;

// GET /orders - órdenes del día
app.get("/orders", async (req, res) => {
  try {
    const sheet = await getOrderSheet();
    const rows = await sheet.getRows();
    const today = getColombiaDateString();
    // Nueva estructura de columnas:
    // 0: # ORDEN, 1: FECHA, 2: HORA, 3: NUMERO, 4: CLIENTE, 5: DIRECCION, 6: ITEMS, 7: ESTADO, 8: METODO DE PAGO, 9: PRECIO TOTAL
    const pedidos = rows
      .filter((r) => (r._rawData[1] || "") === today)
      .map((r) => ({
        id: r._rawData[0],
        hora: r._rawData[2] || "",
        numero: r._rawData[3] || "",
        cliente: r._rawData[4] || "",
        direccion: r._rawData[5] || "",
        detalle: r._rawData[6] || "",
        estado: r._rawData[7],
        fecha: r._rawData[1],
        metodo_pago: r._rawData[8] || "",
        total: r._rawData[9] || "",
      }));
    // Medir delay si corresponde
    if (lastNewOrderId && pedidos.some(p => p.id === lastNewOrderId) && lastNewOrderTimestamp) {
      const delay = Date.now() - lastNewOrderTimestamp;
      console.log(`Delay entre "Nueva orden detectada: ${lastNewOrderId}" y "Pedidos enviados al frontend": ${delay} ms`);
      // Solo mostrar una vez por orden
      lastNewOrderId = null;
      lastNewOrderTimestamp = null;
    }
    console.log("Pedidos enviados al frontend:", pedidos);
    res.json(Array.isArray(pedidos) ? pedidos : []);
  } catch (e) {
    console.error("Error en /orders:", e);
    res.json([]);
  }
});

// POST /orders/:id/state - actualizar estado
app.post("/orders/:id/state", async (req, res) => {
  try {
    const id = req.params.id;
    const { estado } = req.body;
    const sheet = await getOrderSheet();
    const rows = await sheet.getRows();
    // Buscar por índice 0 (# ORDEN)
    const row = rows.find((r) => r._rawData[0] == id);
    if (!row) return res.status(404).json({ error: "No encontrado" });
    if (row._rawData[7] === estado) {
      const pedido = {
        id: row._rawData[0],
        fecha: row._rawData[1],
        hora: row._rawData[2],
        numero: row._rawData[3],
        cliente: row._rawData[4],
        direccion: row._rawData[5],
        detalle: row._rawData[6],
        estado: estado,
        metodo_pago: row._rawData[8],
        total: row._rawData[9],
      };
      crearFacturaPDF(pedido);
    }

    row._rawData[7] = estado;
    row["ESTADO DE ORDEN"] = estado;
    await row.save();

    res.json({ ok: true });
  } catch (e) {
    console.error("Error en /orders/:id/state:", e);
    res.status(500).json({ error: e.message });
  }
});

// Endpoint para recibir notificación de nueva orden desde Google Apps Script
app.post("/notify-new-order", (req, res) => {
  const { orderId } = req.body;
  if (!orderId) {
    return res.status(400).json({ error: "orderId requerido" });
  }
  console.log("Notificación de nueva orden recibida:", orderId);
  // Aquí puedes poner la lógica que quieras (emitir evento, actualizar caché, etc.)
  res.json({ ok: true });
});

// Inicializar y luego arrancar el polling cada 2 segundos
initLastOrderIds().then(() => {
  setInterval(pollNewOrders, 15000); // cada 30 segundos
});

const PORT = 3001;
app.listen(PORT, () => console.log("Kitchen API running on port", PORT));
app.listen(PORT, () => console.log("Kitchen API running on port", PORT));
