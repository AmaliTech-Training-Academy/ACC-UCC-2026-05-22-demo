import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

let nextId = 1;
const notes = [];

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "notes-backend", uptime: process.uptime() });
});

app.get("/api/notes", (_req, res) => {
  res.json(notes);
});

app.post("/api/notes", (req, res) => {
  const text = (req.body?.text || "").toString().trim();
  if (!text) {
    return res.status(400).json({ error: "text is required" });
  }
  const note = { id: nextId++, text, createdAt: new Date().toISOString() };
  notes.unshift(note);
  res.status(201).json(note);
});

app.delete("/api/notes/:id", (req, res) => {
  const id = Number(req.params.id);
  const idx = notes.findIndex((n) => n.id === id);
  if (idx === -1) return res.status(404).json({ error: "not found" });
  const [removed] = notes.splice(idx, 1);
  res.json(removed);
});

app.listen(PORT, () => {
  console.log(`notes-backend listening on http://0.0.0.0:${PORT}`);
});
