import express from "express";
import fs from "fs";
import path from "path";
import cors from "cors";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import http from "http";

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());

const REPORTS_FILE = path.join(__dirname, "reports.json");
// Serve pages
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "home.html")));
app.get("/map", (req, res) => res.sendFile(path.join(__dirname, "map.html")));
app.get("/notif", (req, res) => res.sendFile(path.join(__dirname, "notif.html")));

// GET reports
app.get("/api/reports", (req, res) => {
  if (!fs.existsSync(REPORTS_FILE)) fs.writeFileSync(REPORTS_FILE, "[]");
  const data = JSON.parse(fs.readFileSync(REPORTS_FILE, "utf8"));
  res.json(data);
});

// POST new report
app.post("/api/reports", (req, res) => {
  const report = req.body;
  if (!fs.existsSync(REPORTS_FILE)) fs.writeFileSync(REPORTS_FILE, "[]");
  const data = JSON.parse(fs.readFileSync(REPORTS_FILE, "utf8"));
  data.push(report);
  fs.writeFileSync(REPORTS_FILE, JSON.stringify(data, null, 2));

  // 🔔 Broadcast new report to everyone
  io.emit("newReport", report);

  res.json({ message: "Report saved successfully" });
});

// Start both HTTP + Socket.IO
server.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
