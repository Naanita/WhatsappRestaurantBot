// kitchen-api.js
const express = require("express");
const cors = require("cors");
require("dotenv").config({ path: '../.env' }); // Apunta al .env en la raíz
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const creds = require("../credentials.json"); // Asume que credentials.json está en la raíz
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Sirve los archivos estáticos desde la carpeta public

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
    
    const pedidos = rows
      .filter((r) => r.get("FECHA") === today)
      .map((r) => ({
        id: r.get("# ORDEN"),
        hora: r.get("HORA") || "",
        numero: r.get("NUMERO") || "",
        cliente: r.get("CLIENTE") || "",
        direccion: r.get("DIRECCION DE LA ORDEN") || "",
        detalle: r.get("ITEMS DE LA ORDEN") || "",
        estado: r.get("ESTADO DE ORDEN"),
        fecha: r.get("FECHA"),
        metodo_pago: r.get("METODO DE PAGO") || "",
        total: r.get("PRECIO TOTAL") || "",
      }));
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
    
    const row = rows.find((r) => r.get("# ORDEN") == id);
    if (!row) return res.status(404).json({ error: "No encontrado" });

    row.set("ESTADO DE ORDEN", estado);
    await row.save();

    res.json({ ok: true });
  } catch (e) {
    console.error("Error en /orders/:id/state:", e);
    res.status(500).json({ error: e.message });
  }
});

const PORT = 3001;
app.listen(PORT, () => console.log("Kitchen API running on port", PORT));