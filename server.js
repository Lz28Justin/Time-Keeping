console.log("🚀 server.js file loaded");

const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path");

// FIX: node-fetch compatibility (Node 18+ safe)
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3000;

// Messenger token (Render → Environment Variables)
const PAGE_TOKEN = process.env.PAGE_TOKEN || "";

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// Database
const db = new sqlite3.Database("timekeeping.db", err => {
  if (err) console.error("DB Error:", err.message);
  else console.log("📦 Database connected");
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      time_in TEXT,
      time_out TEXT,
      hours REAL,
      date TEXT
    )
  `);
});

// =====================
// HELPERS
// =====================
function now() {
  return new Date().toISOString();
}

function hoursDiff(start, end) {
  return ((new Date(end) - new Date(start)) / 3600000).toFixed(2);
}

// FORMAT ISO → HH:MM
function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

// =====================
// API: TIME IN
// =====================
app.post("/timein", (req, res) => {
  const { name } = req.body;
  if (!name) return res.json({ error: "Name required" });

  const timeIn = now();
  const date = timeIn.split("T")[0];

  db.run(
    "INSERT INTO records (name, time_in, date) VALUES (?, ?, ?)",
    [name, timeIn, date],
    err => {
      if (err) return res.json({ error: err.message });
      res.json({ message: "Time In recorded", timeIn });
    }
  );
});

// =====================
// API: TIME OUT
// =====================
app.post("/timeout", (req, res) => {
  const { name } = req.body;
  if (!name) return res.json({ error: "Name required" });

  db.get(
    "SELECT * FROM records WHERE name = ? AND time_out IS NULL ORDER BY id DESC",
    [name],
    (err, row) => {
      if (err) return res.json({ error: err.message });
      if (!row) return res.json({ error: "No active Time In" });

      const timeOut = now();
      const hours = hoursDiff(row.time_in, timeOut);

      db.run(
        "UPDATE records SET time_out = ?, hours = ? WHERE id = ?",
        [timeOut, hours, row.id],
        () => res.json({ message: "Time Out recorded", timeOut, hours })
      );
    }
  );
});

// =====================
// DAILY REPORT
// =====================
app.get("/report/today/:name", (req, res) => {
  const today = new Date().toISOString().split("T")[0];

  db.all(
    "SELECT * FROM records WHERE name = ? AND date = ?",
    [req.params.name, today],
    (err, rows) => {
      if (err) return res.json({ error: err.message });
      res.json(rows);
    }
  );
});

// =====================
// WEEKLY REPORT
// =====================
app.get("/report/week/:name", (req, res) => {
  db.all(
    `
    SELECT * FROM records 
    WHERE name = ? AND date >= date('now','-7 days')
    `,
    [req.params.name],
    (err, rows) => {
      if (err) return res.json({ error: err.message });
      res.json(rows);
    }
  );
});

// =====================
// EXPORT CSV (FIXED TIME)
// =====================
app.get("/export", (req, res) => {
  db.all("SELECT * FROM records", [], (err, rows) => {
    if (err) return res.send(err.message);

    let csv = "Name,Time In,Time Out,Hours,Date\n";

    rows.forEach(r => {
      csv += `${r.name},${formatTime(r.time_in)},${formatTime(r.time_out)},${r.hours || ""},${r.date}\n`;
    });

    res.header("Content-Type", "text/csv");
    res.attachment("timekeeping.csv");
    res.send(csv);
  });
});

// =====================
// MESSENGER WEBHOOK VERIFY
// =====================
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = "timekeeping_verify";

  if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
    console.log("📨 Webhook verified");
    res.send(req.query["hub.challenge"]);
  } else {
    res.sendStatus(403);
  }
});

// =====================
// MESSENGER WEBHOOK MESSAGE
// =====================
app.post("/webhook", async (req, res) => {
  try {
    const event = req.body.entry?.[0]?.messaging?.[0];
    if (!event || !event.message) return res.sendStatus(200);

    const sender = event.sender.id;
    const text = event.message.text?.toLowerCase() || "";

    let reply = "Commands: time in | time out | today | week";

    if (text === "time in") reply = "✅ Time In recorded";
    if (text === "time out") reply = "⏱ Time Out recorded";
    if (text === "today") reply = "📊 Today’s report ready";
    if (text === "week") reply = "📅 Weekly report ready";

    await fetch(
      `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: sender },
          message: { text: reply }
        })
      }
    );

    res.sendStatus(200);
  } catch (err) {
    console.error("Messenger Error:", err);
    res.sendStatus(500);
  }
});

// =====================
// START SERVER
// =====================
app.listen(PORT, () => {
  console.log(`✅ Timekeeping System running on port ${PORT}`);
});
