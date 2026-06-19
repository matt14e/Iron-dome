import { searchDeals, getDealHistory } from './hubspot.js';
import { corgiCorpOwnerIds, corgiTechOwnerIds } from './teams.js';
import { sleep } from './util.js';

const DAY = 86400000;

// Module-level progress + aggregates for a one-off "dossier" scan of a given integration's
// corp -> tech deal-owner reassignments. One process, survives across HTTP requests.
let state = { phase: 'idle', running: false, done: false, appId: null, scanned: 0, total: 0, events: 0, distinctDeals: 0, error: null, startedAt: null, finishedAt: null };
let agg = null;

export function getDossierState() { return { state, agg }; }

export async function startDossier({ appId, sinceMs, nowMs }) {
  if (state.running) return { alreadyRunning: true };
  state = { phase: 'scanning', running: true, done: false, appId: String(appId), scanned: 0, total: 0, events: 0, distinctDeals: 0, error: null, startedAt: nowMs, finishedAt: null };
  agg = { totals: { all: 0, m30: 0, w7: 0 }, byRecipient: {}, byVictim: {} };
  loop({ appId: String(appId), sinceMs, nowMs }).catch((e) => { state.error = e.message; state.running = false; state.done = true; state.phase = 'error'; });
  return { started: true };
}

async function loop({ appId, sinceMs, nowMs }) {
  const corp = new Set((await corgiCorpOwnerIds()).map(String));
  const tech = new Set((await corgiTechOwnerIds()).map(String));
  const w7 = nowMs - 7 * DAY, m30 = nowMs - 30 * DAY;
  const filterGroups = [{ filters: [{ propertyName: 'hs_lastmodifieddate', operator: 'GTE', value: String(sinceMs) }] }];
  const seenDeals = new Set();

  const bump = (obj, key, ts) => {
    const e = (obj[key] ||= { all: 0, m30: 0, w7: 0 });
    e.all++; if (ts >= m30) e.m30++; if (ts >= w7) e.w7++;
  };

  let after;
  do {
    const page = await searchDeals(filterGroups, ['dealname'], 100, after, [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }]);
    if (typeof page.total === 'number') state.total = page.total;
    const deals = page.results || [];
    after = page.paging?.next?.after || null;

    for (const d of deals) {
      const hist = await getDealHistory(d.id, ['hubspot_owner_id']);
      await sleep(120);
      state.scanned++;
      const entries = hist.propertiesWithHistory?.hubspot_owner_id || []; // most-recent first
      for (let i = 0; i < entries.length - 1; i++) {
        const cur = entries[i], prev = entries[i + 1];
        if (cur.sourceType !== 'INTEGRATION' || String(cur.sourceId) !== appId) continue;
        if (!(prev.value && corp.has(String(prev.value)))) continue;      // displaced a Corgi Corp owner
        if (!(cur.value && tech.has(String(cur.value)))) continue;        // ...to a Corgi Tech owner
        const ts = Date.parse(cur.timestamp);
        agg.totals.all++; if (ts >= m30) agg.totals.m30++; if (ts >= w7) agg.totals.w7++;
        bump(agg.byRecipient, String(cur.value), ts);
        bump(agg.byVictim, String(prev.value), ts);
        state.events++; seenDeals.add(d.id);
      }
    }
    state.distinctDeals = seenDeals.size;
  } while (after);

  state.running = false; state.done = true; state.phase = 'done'; state.finishedAt = Date.now();
}
