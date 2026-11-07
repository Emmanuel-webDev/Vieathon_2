const mod = process.getBuiltinModule("node:sqlite");
const db = new mod.DatabaseSync(process.env.NIGHTWATCH_DB_PATH);
const action = process.argv[2] || "insert";

if (action === "insert") {
  db.exec(`INSERT INTO events (watch_id, ts, type, severity, title, detail) VALUES ('test_watch_persistence', 1700000000000, 'test_event', 'high', 'Persistent Volume Proof', '{"persisted":true}')`);
  const row = db.prepare("SELECT * FROM events WHERE watch_id = 'test_watch_persistence'").get();
  console.log("INSERTED ROW BEFORE RESTART:", JSON.stringify(row));
} else if (action === "verify") {
  const row = db.prepare("SELECT * FROM events WHERE watch_id = 'test_watch_persistence'").get();
  console.log("QUERIED ROW AFTER RESTART:", JSON.stringify(row));
}
