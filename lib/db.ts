/**
 * Tiny SQLite store for Night Shift watches, using Node's built-in node:sqlite (Node >= 22.13).
 * Loaded via process.getBuiltinModule so the bundler never tries to resolve it.
 */
import path from "path";
import fs from "fs";

let _db: any;
let _dbPath: string | null = null;

export function db(): any {
  let file =
    process.env.NIGHTWATCH_DB_PATH ||
    path.join(process.env.NIGHTWATCH_DATA_DIR || path.join(process.cwd(), "data"), "nightwatch.db");
  if (_db && _dbPath === file) return _db;
  const mod = (process as any).getBuiltinModule?.("node:sqlite");
  if (!mod) throw new Error("node:sqlite is unavailable. Night Shift watch mode needs Node >= 22.13.");
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch {
    // If the configured path cannot be created or written to (e.g. Render with no mounted volume), fall back to /tmp
    file = path.join(process.env.TMPDIR || "/tmp", "nightwatch.db");
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  _db = new mod.DatabaseSync(file);
  _dbPath = file;
  _db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS watches (
      id TEXT PRIMARY KEY,
      secret_hash TEXT NOT NULL,
      target TEXT NOT NULL,
      kind TEXT NOT NULL,
      interval_min INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      next_run INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'baselining',
      state TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      watch_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS events_watch ON events (watch_id, ts);
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      tier TEXT NOT NULL,
      target TEXT NOT NULL,
      amount TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      ip TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      tx_hash TEXT UNIQUE,
      payer TEXT,
      paid_at INTEGER,
      consumed_at INTEGER,
      job_id TEXT
    );
    CREATE INDEX IF NOT EXISTS orders_open ON orders (status, amount, expires_at);
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      secret_hash TEXT NOT NULL,
      order_id TEXT NOT NULL,
      target TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      report TEXT,
      report_hash TEXT,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS job_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS job_events_job ON job_events (job_id, id);
    CREATE TABLE IF NOT EXISTS ai_daily_usage (
      day TEXT PRIMARY KEY,
      used INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_cache (
      cache_key TEXT PRIMARY KEY,
      files_hash TEXT NOT NULL,
      task TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ai_cache_files ON ai_cache (files_hash);
  `);
  return _db;
}
