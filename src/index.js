import express from 'express';
import cron from 'node-cron';
import { config, FN3_CRON, TIMEZONE, REVERT_LOOP_MS, SWEEP_INTERVAL_MS, TOGGLES } from './config.js';
import { initDb, isEnabled, getConfig, setConfig, pinDeal, unpinDeal, listPinned, recentAudit } from './db.js';
import { verifySignature, dispatchEvents } from './webhooks.js';
import { processDueReverts } from './revertQueue.js';
import { runDailyReassignment } from './function3.js';
import { ensureInbound, sweepInbound } from './function2.js';
import { getTeamDiagnostics } from './teams.js';
import { extractDealIdFromUrl } from './util.js';
import { dashboardHtml } from './ui.js';

const app = express();
app.set('trust proxy', true); // Railway terminates TLS at a proxy; needed for correct https URL in signature checks
// capture raw body for webhook signature verification
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));

// --- simple shared-password gate for the dashboard API ---
function requirePassword(req, res, next) {
  if (req.get('x-ui-password') === config.uiPassword) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

// --- HubSpot webhooks ---
app.post('/webhooks', async (req, res) => {
  if (!verifySignature(req)) return res.status(401).end();
  res.status(200).end(); // ack fast; process async
  const events = Array.isArray(req.body) ? req.body : [];
  dispatchEvents(events).catch((e) => console.error('[webhook] dispatch error:', e.message));
});

// --- dashboard ---
app.get('/', (_req, res) => res.type('html').send(dashboardHtml));
app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/api/status', requirePassword, async (_req, res) => {
  res.json({
    config: {
      function1_enabled: await isEnabled(TOGGLES.fn1),
      function2_enabled: await isEnabled(TOGGLES.fn2),
      function3_enabled: await isEnabled(TOGGLES.fn3),
      function3_daily_count: await getConfig(TOGGLES.fn3Count),
    },
    pinned: await listPinned(),
    audit: await recentAudit(100),
  });
});

app.post('/api/toggle', requirePassword, async (req, res) => {
  const { key, value } = req.body || {};
  const allowed = Object.values(TOGGLES);
  if (!allowed.includes(key)) return res.status(400).json({ error: 'unknown key' });
  await setConfig(key, key === TOGGLES.fn3Count ? String(parseInt(value, 10) || 0) : String(!!value));
  res.json({ ok: true });
});

app.post('/api/pin', requirePassword, async (req, res) => {
  const dealId = extractDealIdFromUrl(req.body?.url || '');
  if (!dealId) return res.status(400).json({ error: 'could not parse deal id from URL' });
  await pinDeal(dealId);
  // Pins are governed by Function 2: this sets Inbound now if Fn2 is ON, and ongoing
  // enforcement (revert-if-changed) also requires Fn2 ON.
  try { await ensureInbound(dealId); }
  catch (e) { console.error('[pin] ensureInbound failed:', e.message); }
  res.json({ ok: true, dealId });
});

app.post('/api/unpin', requirePassword, async (req, res) => {
  await unpinDeal(String(req.body?.dealId || ''));
  res.json({ ok: true });
});

// Function 2 sweep: preview (changes nothing) and apply (forces qualifying deals to Inbound)
app.get('/api/sweep/preview', requirePassword, async (_req, res) => {
  try { res.json(await sweepInbound({ apply: false })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/sweep/apply', requirePassword, async (_req, res) => {
  try { res.json(await sweepInbound({ apply: true })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// read-only diagnostics: verifies HubSpot token + team resolution (changes nothing)
app.get('/api/diag', requirePassword, async (_req, res) => {
  try {
    res.json({ ok: true, ...(await getTeamDiagnostics()) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// manual trigger for Function 3 (handy for testing)
app.post('/api/run-fn3', requirePassword, async (_req, res) => {
  const result = await runDailyReassignment({ trigger: 'manual' });
  res.json(result);
});

async function main() {
  await initDb();

  // 60s enforcement loop (drains pending reverts as they come due)
  setInterval(() => { processDueReverts().catch((e) => console.error('[loop] revert error:', e.message)); }, REVERT_LOOP_MS);

  // proactive Function 2 sweep — only runs while Function 2 is enabled
  setInterval(async () => {
    try {
      if (!(await isEnabled(TOGGLES.fn2))) return;
      const r = await sweepInbound({ apply: true });
      if (r.applied) console.log(`[sweep] forced ${r.applied}/${r.count} deals to Inbound`);
    } catch (e) { console.error('[sweep] error:', e.message); }
  }, SWEEP_INTERVAL_MS);

  // daily reassignment at 22:00 America/Denver
  cron.schedule(FN3_CRON, () => { runDailyReassignment({ trigger: 'cron' }).catch((e) => console.error('[cron] fn3 error:', e.message)); },
    { timezone: TIMEZONE });

  app.listen(config.port, () => console.log(`[server] listening on :${config.port}`));
}

main().catch((e) => { console.error('fatal:', e); process.exit(1); });
