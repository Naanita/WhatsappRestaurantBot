// kitchen-api.js
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const creds = require("./credentials.json");
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

    // Solo crear la factura si el pedido es realmente nuevo (la fila acaba de ser creada)
    // Esto se detecta si el estado actual y el estado recibido son iguales (primera actualización tras creación)
    // O si quieres aún más seguro: solo si el estado actual y el recibido son iguales Y el timestamp de creación es muy reciente
    // Pero aquí, lo más simple: solo si el estado actual y el recibido son iguales (primer POST tras creación)
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

const PORT = 3001;
app.listen(PORT, () => console.log("Kitchen API running on port", PORT));
app.listen(PORT, () => console.log("Kitchen API running on port", PORT));
