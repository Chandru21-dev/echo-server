/* Echo push server (optional)
   Lets you broadcast an announcement to every subscriber's phone,
   even when the app is closed. Free to host on Render / Railway / Fly.io.

   Run locally:  npm install && npm start
*/
const express = require("express");
const cors = require("cors");
const webpush = require("web-push");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// --- VAPID keys ---------------------------------------------------------
// These MUST match the public key in the app's config.js.
const VAPID_PUBLIC =
  process.env.VAPID_PUBLIC_KEY ||
  "BEIeNBcGWzA9Pd0jsZSY8Fwh4EKJX4h64cKabIIrYsfuLnyqEgq-Y-GKYwp2HHDTxeDzF1NI5n-huk6niugawVc";
const VAPID_PRIVATE =
  process.env.VAPID_PRIVATE_KEY ||
  "mMN117TlMG9YP7r26V_50svcQ8ph2dfcfNo4xF94aKw";
const CONTACT = process.env.VAPID_CONTACT || "mailto:you@example.com";

webpush.setVapidDetails(CONTACT, VAPID_PUBLIC, VAPID_PRIVATE);

// Simple admin key so only you can broadcast.
const ADMIN_KEY = process.env.ADMIN_KEY || "change-me";

// --- Subscription storage (JSON file; swap for a DB in production) -------
const DB = path.join(__dirname, "subscriptions.json");
const load = () => { try { return JSON.parse(fs.readFileSync(DB)); } catch { return []; } };
const save = (s) => fs.writeFileSync(DB, JSON.stringify(s, null, 2));

// --- Scheduled reminders storage ----------------------------------------
const SDB = path.join(__dirname, "scheduled.json");
const loadS = () => { try { return JSON.parse(fs.readFileSync(SDB)); } catch { return []; } };
const saveS = (s) => fs.writeFileSync(SDB, JSON.stringify(s, null, 2));

app.get("/", (_req, res) => res.send("Echo push server is running."));

// Client registers its push subscription here.
app.post("/subscribe", (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: "invalid subscription" });
  const subs = load();
  if (!subs.find((s) => s.endpoint === sub.endpoint)) { subs.push(sub); save(subs); }
  res.json({ ok: true, count: subs.length });
});

// Broadcast to everyone. Protect with ADMIN_KEY header for real use.
app.post("/broadcast", async (req, res) => {
  // Uncomment to require the admin key:
  // if (req.get("x-admin-key") !== ADMIN_KEY) return res.status(401).json({ error: "unauthorized" });

  const { title = "Echo", body = "", url = "/" } = req.body || {};
  const payload = JSON.stringify({ title, body, url });
  const subs = load();
  let ok = 0, gone = 0;
  const keep = [];

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, payload);
        ok++; keep.push(sub);
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) gone++; // expired
        else keep.push(sub);
      }
    })
  );
  save(keep);
  res.json({ sent: ok, removed: gone, total: subs.length });
});

// Schedule a reminder to be pushed at a specific time (even when the app is closed).
app.post("/schedule", (req, res) => {
  const { subscription, title, body, fireAt } = req.body || {};
  if (!subscription || !subscription.endpoint || !fireAt) {
    return res.status(400).json({ error: "subscription and fireAt required" });
  }
  const items = loadS();
  items.push({
    id: Date.now() + "-" + Math.random().toString(36).slice(2),
    subscription, title: title || "Reminder", body: body || "", fireAt: Number(fireAt),
  });
  saveS(items);
  res.json({ ok: true, scheduled: items.length });
});

// Manual tick endpoint — lets a free cron service wake the server and flush due reminders.
app.get("/tick", async (_req, res) => { const n = await flushDue(); res.json({ sent: n }); });

// Check for due reminders and push them.
async function flushDue() {
  const items = loadS();
  if (!items.length) return 0;
  const now = Date.now();
  const due = items.filter((i) => i.fireAt <= now);
  if (!due.length) return 0;
  const keep = items.filter((i) => i.fireAt > now);
  let sent = 0;
  for (const it of due) {
    try {
      await webpush.sendNotification(it.subscription, JSON.stringify({ title: it.title, body: it.body, url: "/" }));
      sent++;
    } catch (err) { /* drop expired/failed */ }
  }
  saveS(keep);
  return sent;
}
setInterval(flushDue, 30000); // every 30s while the server is awake

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Echo push server on :${PORT}`));
