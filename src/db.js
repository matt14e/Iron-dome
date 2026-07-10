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
    CREATE TABLE IF NOT EXISTS backfill_changes (
      id         BIGSERIAL PRIMARY KEY,
      deal_id    TEXT NOT NULL,
      name       TEXT,
      field      TEXT NOT NULL,
      from_val   TEXT,
      to_val     TEXT,
      applied    BOOLEAN NOT NULL DEFAULT false
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
    CREATE TABLE IF NOT EXISTS fn1_exempt_deals (
      deal_id    TEXT PRIMARY KEY,           -- deals excluded from Function 1 role-lock enforcement
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS detected_enemies (
      app_id      TEXT PRIMARY KEY,          -- HubSpot application id reassigning Corgi Corp deals
      hits        INTEGER NOT NULL DEFAULT 0,
      sample_deal TEXT,
      first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
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

// --- Function 1 backfill staging ---
export async function clearBackfill() {
  await pool.query(`DELETE FROM backfill_changes`);
}
export async function addBackfillChange(c) {
  await pool.query(
    `INSERT INTO backfill_changes (deal_id, name, field, from_val, to_val) VALUES ($1, $2, $3, $4, $5)`,
    [c.deal, c.name ?? null, c.field, c.from ?? null, c.to ?? null],
  );
}
export async function backfillSummary() {
  const { rows: c } = await pool.query(
    `SELECT count(*)::int AS changes, count(distinct deal_id)::int AS deals,
            count(*) FILTER (WHERE applied)::int AS applied FROM backfill_changes`,
  );
  const { rows: sample } = await pool.query(
    `SELECT deal_id, name, field, from_val, to_val FROM backfill_changes ORDER BY id LIMIT 1000`,
  );
  return { ...c[0], sample };
}
export async function pendingBackfillByDeal() {
  const { rows } = await pool.query(
    `SELECT deal_id, field, to_val FROM backfill_changes WHERE NOT applied ORDER BY deal_id`,
  );
  const byDeal = {};
  for (const r of rows) (byDeal[r.deal_id] ||= {})[r.field] = r.to_val;
  return byDeal;
}
export async function markBackfillApplied(dealId) {
  await pool.query(`UPDATE backfill_changes SET applied = true WHERE deal_id = $1`, [dealId]);
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

// --- Function 1 exemptions (deals excluded from the Corp role-lock) ---
export async function exemptDeal(dealId) {
  await pool.query(`INSERT INTO fn1_exempt_deals (deal_id) VALUES ($1) ON CONFLICT DO NOTHING`, [String(dealId)]);
}
export async function unexemptDeal(dealId) {
  await pool.query(`DELETE FROM fn1_exempt_deals WHERE deal_id = $1`, [String(dealId)]);
}
export async function isExempt(dealId) {
  const { rows } = await pool.query(`SELECT 1 FROM fn1_exempt_deals WHERE deal_id = $1`, [String(dealId)]);
  return rows.length > 0;
}
export async function listExempt() {
  const { rows } = await pool.query(`SELECT deal_id, created_at FROM fn1_exempt_deals ORDER BY created_at DESC`);
  return rows;
}

// --- Enemy detection ---
/** Record an attacking app id; returns true if this app was newly detected (first time). */
export async function recordEnemy(appId, dealId) {
  const { rows } = await pool.query(
    `INSERT INTO detected_enemies (app_id, hits, sample_deal) VALUES ($1, 1, $2)
       ON CONFLICT (app_id) DO UPDATE SET hits = detected_enemies.hits + 1, last_seen = now(),
         sample_deal = COALESCE(EXCLUDED.sample_deal, detected_enemies.sample_deal)
     RETURNING (xmax = 0) AS inserted`,
    [String(appId), dealId ? String(dealId) : null],
  );
  return rows[0]?.inserted === true;
}
export async function listEnemies() {
  const { rows } = await pool.query(`SELECT * FROM detected_enemies ORDER BY last_seen DESC`);
  return rows;
}
export async function clearEnemies() {
  await pool.query(`DELETE FROM detected_enemies`);
}
