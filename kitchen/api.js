// kitchen/api.js
const express = require("express");
const cors = require("cors");
require("dotenv").config({ path: '../.env' });
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const creds = require("../credentials.json");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

function getServiceAccountAuth() {
    return new JWT({
        email: creds.client_email,
        key: creds.private_key.replace(/\\n/g, "\n"),
        scopes: [
            "https://www.googleapis.com/auth/spreadsheets",
        ],
    });
}

async function getOrderSheet() {
    const serviceAccountAuth = getServiceAccountAuth();
    const doc = new GoogleSpreadsheet(process.env.ORDEN_STATE, serviceAccountAuth);
    await doc.loadInfo();
    return doc.sheetsByTitle["ORDENES"];
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

        res.status(200).json(pedidos);
    } catch (e) {
        console.error("Error en GET /orders:", e);
        res.status(500).json({ error: "Error interno del servidor al obtener las órdenes." });
    }
});

// POST /orders/:id/state - actualizar estado
app.post("/orders/:id/state", async (req, res) => {
    try {
        const { id } = req.params;
        const { estado } = req.body;

        if (!id || !estado) {
            return res.status(400).json({ error: "Faltan los parámetros 'id' o 'estado'." });
        }

        const sheet = await getOrderSheet();
        const rows = await sheet.getRows();

        const row = rows.find((r) => r.get("# ORDEN") == id);
        if (!row) {
            return res.status(404).json({ error: "Orden no encontrada." });
        }

        row.set("ESTADO DE ORDEN", estado);
        await row.save();

        res.status(200).json({ ok: true, message: "Estado actualizado correctamente." });
    } catch (e) {
        console.error(`Error en POST /orders/${req.params.id}/state:`, e);
        res.status(500).json({ error: "Error interno del servidor al actualizar el estado." });
    }
});

const PORT = process.env.KITCHEN_API_PORT || 3001;
app.listen(PORT, () => console.log(`Kitchen API running on port ${PORT}`));