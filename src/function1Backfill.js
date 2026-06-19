import { ROLE_PROPS, TIMEZONE, FN1_BACKFILL_YEAR, FN1_BACKFILL_MONTH } from './config.js';
import { searchDeals, getDealHistory, updateDeal } from './hubspot.js';
import { corgiCorpOwnerIds } from './teams.js';
import { logAction, clearBackfill, addBackfillChange, pendingBackfillByDeal, markBackfillApplied } from './db.js';
import { markSelfWrite } from './selfWrites.js';
import { monthBoundsMs, sleep } from './util.js';

const CLOSEDWON = 'closedwon';
const THROTTLE_MS = 120; // gap between HubSpot calls to respect the per-second burst limit

// Module-level progress for the long-running scan (survives across HTTP requests; one process).
let state = { phase: 'idle', running: false, done: false, pagesDone: 0, scanned: 0, qualifying: 0, found: 0, error: null, startedAt: null, finishedAt: null };
export function getBackfillState() { return state; }

/** Kick off the scan in the background (not awaited). Stores proposed changes in the DB. */
export async function startBackfillScan() {
  if (state.running) return { alreadyRunning: true, state };
  state = { phase: 'scanning', running: true, done: false, pagesDone: 0, scanned: 0, qualifying: 0, found: 0, error: null, startedAt: Date.now(), finishedAt: null };
  scanLoop().catch((e) => { state.error = e.message; state.running = false; state.done = true; state.phase = 'error'; });
  return { started: true };
}

async function scanLoop() {
  await clearBackfill();
  const corp = new Set((await corgiCorpOwnerIds()).map(String));
  const [monthStart, monthEnd] = monthBoundsMs(FN1_BACKFILL_YEAR, FN1_BACKFILL_MONTH, TIMEZONE);
  const filterGroups = [{ filters: [
    { propertyName: 'hs_v2_date_entered_closedwon', operator: 'GTE', value: String(monthStart) },
  ] }];

  let after;
  do {
    const page = await searchDeals(filterGroups, ['dealname', ...ROLE_PROPS], 100, after);
    const candidates = page.results || [];
    after = page.paging?.next?.after || null;

    for (const d of candidates) {
      const hist = await getDealHistory(d.id, ['dealstage', ...ROLE_PROPS]);
      await sleep(THROTTLE_MS);
      state.scanned++;
      const h = hist.propertiesWithHistory || {};

      const closedTimes = (h.dealstage || []).filter((e) => e.value === CLOSEDWON).map((e) => Date.parse(e.timestamp));
      if (!closedTimes.length) continue;
      const firstClosedTs = Math.min(...closedTimes);
      if (firstClosedTs < monthStart || firstClosedTs >= monthEnd) continue;
      state.qualifying++;

      for (const field of ROLE_PROPS) {
        const current = d.properties[field] ?? null;
        if (current && corp.has(String(current))) continue;
        const entries = (h[field] || []).slice().sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
        let target = null;
        for (const e of entries) {
          if (Date.parse(e.timestamp) >= firstClosedTs && e.value && corp.has(String(e.value))) { target = e.value; break; }
        }
        if (target && String(target) !== String(current)) {
          await addBackfillChange({ deal: d.id, name: d.properties.dealname, field, from: current, to: target });
          state.found++;
        }
      }
    }
    state.pagesDone++;
  } while (after);

  state.running = false; state.done = true; state.phase = 'done'; state.finishedAt = Date.now();
}

/** Apply the staged changes (grouped per deal). Safe to re-run; only applies unapplied rows. */
export async function applyBackfill() {
  const byDeal = await pendingBackfillByDeal();
  let applied = 0;
  for (const [deal, set] of Object.entries(byDeal)) {
    try {
      await updateDeal(deal, set);
      for (const [k, v] of Object.entries(set)) markSelfWrite(deal, k, v);
      await logAction({ fn: 'fn1', dealId: deal, property: Object.keys(set).join(','),
        newValue: Object.values(set).join(','), note: 'backfill: restored Corgi Corp owner(s)' });
      await markBackfillApplied(deal);
      applied++;
      await sleep(THROTTLE_MS);
    } catch (e) { console.error('[backfill apply] failed on', deal, e.message); }
  }
  return { applied, deals: Object.keys(byDeal).length };
}
