import pg from 'pg';
import { config, TOGGLES, FN3_DEFAULT_DAILY_COUNT } from './config.js';

const { Pool } = pg;

// Railway's internal DATABASE_URL connects over the private network WITHOUT SSL. Only enable
// SSL when the connection string explicitly asks for it (e.g. a public URL with sslmode=require).
function sslFor(url) {
  if (!url) return false;
  return /sslmode=require/i.test(url) ? { rejectUnauthorized: false } : false;
}

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: sslFor(config.databaseUrl),
});

/** Create tables and seed default config on boot. */
export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pinned_deals (
      deal_id    TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS pending_reverts (
      id         BIGSERIAL PRIMARY KEY,
      deal_id    TEXT NOT NULL,
      property   TEXT NOT NULL,
      target     TEXT,                       -- value to restore (null clears the field)
      reason     TEXT NOT NULL,
      due_at     TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (deal_id, property)
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id         BIGSERIAL PRIMARY KEY,
      fn         TEXT NOT NULL,              -- 'fn1' | 'fn2' | 'fn3'
      deal_id    TEXT,
      property   TEXT,
      old_value  TEXT,
      new_value  TEXT,
      actor      TEXT,
      note       TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Seed defaults (only if missing)
  const defaults = {
    [TOGGLES.fn1]: 'false',
    [TOGGLES.fn2]: 'false',
    [TOGGLES.fn3]: 'false',
    [TOGGLES.fn3Count]: String(FN3_DEFAULT_DAILY_COUNT),
  };
  for (const [key, value] of Object.entries(defaults)) {
    await pool.query(
      `INSERT INTO config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      [key, value],
    );
  }
}

export async function getConfig(key) {
  const { rows } = await pool.query(`SELECT value FROM config WHERE key = $1`, [key]);
  return rows[0]?.value ?? null;
}
export async function setConfig(key, value) {
  await pool.query(
    `INSERT INTO config (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, String(value)],
  );
}
export async function isEnabled(toggleKey) {
  return (await getConfig(toggleKey)) === 'true';
}

// --- Pinned deals (Function 2 UI) ---
export async function pinDeal(dealId) {
  await pool.query(
    `INSERT INTO pinned_deals (deal_id) VALUES ($1) ON CONFLICT DO NOTHING`,
    [dealId],
  );
}
export async function unpinDeal(dealId) {
  await pool.query(`DELETE FROM pinned_deals WHERE deal_id = $1`, [dealId]);
}
export async function isPinned(dealId) {
  const { rows } = await pool.query(`SELECT 1 FROM pinned_deals WHERE deal_id = $1`, [dealId]);
  return rows.length > 0;
}
export async function listPinned() {
  const { rows } = await pool.query(`SELECT deal_id, created_at FROM pinned_deals ORDER BY created_at DESC`);
  return rows;
}

// --- Pending reverts (the 60s enforcement queue) ---
export async function enqueueRevert({ dealId, property, target, reason, dueAt }) {
  // One pending revert per (deal, property); newest wins.
  await pool.query(
    `INSERT INTO pending_reverts (deal_id, property, target, reason, due_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (deal_id, property)
     DO UPDATE SET target = EXCLUDED.target, reason = EXCLUDED.reason, due_at = EXCLUDED.due_at`,
    [dealId, property, target, reason, dueAt],
  );
}
export async function dueReverts() {
  const { rows } = await pool.query(`SELECT * FROM pending_reverts WHERE due_at <= now() ORDER BY due_at ASC`);
  return rows;
}
export async function deleteRevert(id) {
  await pool.query(`DELETE FROM pending_reverts WHERE id = $1`, [id]);
}

// --- Audit log ---
export async function logAction(entry) {
  const { fn, dealId = null, property = null, oldValue = null, newValue = null, actor = null, note = null } = entry;
  await pool.query(
    `INSERT INTO audit_log (fn, deal_id, property, old_value, new_value, actor, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [fn, dealId, property, oldValue, newValue, actor, note],
  );
}
export async function recentAudit(limit = 100) {
  const { rows } = await pool.query(`SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1`, [limit]);
  return rows;
}
