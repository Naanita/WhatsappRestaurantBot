// kitchen-api.js
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const creds = require("./credentials.json");

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

// GET /orders - órdenes del día
app.get("/orders", async (req, res) => {
  try {
    const sheet = await getOrderSheet();
    const rows = await sheet.getRows();
    const today = getColombiaDateString();
    console.log("Hoy:", today);
    rows.forEach((r, i) => {
      console.log(`Fila ${i + 2}:`, r._rawData);
    });
    // Índices según tu log:
    // 0: # ORDEN, 1: FECHA, 2: HORA, 3: ITEMS DE LA ORDEN, 4: ESTADO DE ORDEN, 5: DIRECCION, 6: METODO DE PAGO, 7: PRECIO TOTAL
    const pedidos = rows
      .filter((r) => (r._rawData[1] || "") === today)
      .map((r) => ({
        id: r._rawData[0],
        hora: r._rawData[2] || "",
        detalle: r._rawData[3] || "",
        estado: r._rawData[4],
        fecha: r._rawData[1],
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
    row._rawData[4] = estado; // Índice 4 = ESTADO DE ORDEN
    row["ESTADO DE ORDEN"] = estado; // Por si acaso
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
