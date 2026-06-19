import { ROLE_PROPS, TIMEZONE, FN1_BACKFILL_YEAR, FN1_BACKFILL_MONTH } from './config.js';
import { searchDeals, getDealHistory, updateDeal } from './hubspot.js';
import { corgiCorpOwnerIds } from './teams.js';
import { logAction } from './db.js';
import { markSelfWrite } from './selfWrites.js';
import { monthBoundsMs } from './util.js';

const CLOSEDWON = 'closedwon';

/**
 * One-time Function 1 backfill (SPEC §4a).
 * For deals whose FIRST move into Closed Won was in the configured month, restore role fields to the
 * most-recent post-close Corgi Corp holder when they've since been changed to a non-Corgi-Corp person.
 * dry-run by default; pass { apply: true } to write.
 */
export async function backfillFn1({ apply = false, limit = 4000 } = {}) {
  const corp = new Set((await corgiCorpOwnerIds()).map(String));
  const [monthStart, monthEnd] = monthBoundsMs(FN1_BACKFILL_YEAR, FN1_BACKFILL_MONTH, TIMEZONE);

  // Candidate superset: deals whose LATEST closed-won entry is on/after the month start.
  // (We confirm FIRST-close-in-month via history below.)
  const filterGroups = [{ filters: [
    { propertyName: 'hs_v2_date_entered_closedwon', operator: 'GTE', value: String(monthStart) },
  ] }];
  const props = ['dealname', ...ROLE_PROPS];

  const candidates = [];
  let after;
  do {
    const page = await searchDeals(filterGroups, props, 100, after);
    candidates.push(...(page.results || []));
    after = page.paging?.next?.after;
  } while (after && candidates.length < limit);

  const changes = [];
  let scanned = 0, qualifying = 0;
  for (const d of candidates) {
    scanned++;
    const hist = await getDealHistory(d.id, ['dealstage', ...ROLE_PROPS]);
    const h = hist.propertiesWithHistory || {};

    // FIRST closed-won = earliest dealstage history entry whose value is closedwon
    const closedTimes = (h.dealstage || []).filter((e) => e.value === CLOSEDWON).map((e) => Date.parse(e.timestamp));
    if (!closedTimes.length) continue;
    const firstClosedTs = Math.min(...closedTimes);
    if (firstClosedTs < monthStart || firstClosedTs >= monthEnd) continue; // first close not in target month
    qualifying++;

    for (const field of ROLE_PROPS) {
      const current = d.properties[field] ?? null;
      if (current && corp.has(String(current))) continue; // currently a Corgi Corp member -> leave alone

      // most-recent post-close history entry whose value is a current Corgi Corp member
      const entries = (h[field] || []).slice().sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
      let target = null;
      for (const e of entries) {
        if (Date.parse(e.timestamp) >= firstClosedTs && e.value && corp.has(String(e.value))) { target = e.value; break; }
      }
      if (target && String(target) !== String(current)) {
        changes.push({ deal: d.id, name: d.properties.dealname, field, from: current, to: target });
      }
    }
  }

  const dealsToChange = new Set(changes.map((c) => c.deal)).size;

  if (!apply) {
    return { dryRun: true, month: `${FN1_BACKFILL_YEAR}-${String(FN1_BACKFILL_MONTH).padStart(2, '0')}`,
      scanned, qualifying, dealsToChange, totalChanges: changes.length, changes: changes.slice(0, 200) };
  }

  // group changes per deal -> one PATCH each
  const byDeal = {};
  for (const c of changes) (byDeal[c.deal] ||= {})[c.field] = c.to;
  let applied = 0;
  for (const [deal, set] of Object.entries(byDeal)) {
    try {
      await updateDeal(deal, set);
      for (const [k, v] of Object.entries(set)) markSelfWrite(deal, k, v);
      await logAction({ fn: 'fn1', dealId: deal, property: Object.keys(set).join(','),
        newValue: Object.values(set).join(','), note: 'backfill: restored Corgi Corp owner(s)' });
      applied++;
    } catch (e) { console.error('[backfill] failed on', deal, e.message); }
  }
  return { applied, dealsChanged: Object.keys(byDeal).length, totalChanges: changes.length, scanned, qualifying };
}
