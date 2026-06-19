import { ROLE_PROPS, TIMEZONE, FN1_BACKFILL_YEAR, FN1_BACKFILL_MONTH } from './config.js';
import { searchDeals, getDealHistory, updateDeal } from './hubspot.js';
import { corgiCorpOwnerIds } from './teams.js';
import { logAction } from './db.js';
import { markSelfWrite } from './selfWrites.js';
import { monthBoundsMs } from './util.js';

const CLOSEDWON = 'closedwon';

/**
 * One-time Function 1 backfill (SPEC §4a), processed ONE search page (~100 deals) per call so a single
 * HTTP request never times out. Pass the returned `nextAfter` back in to continue; null = done.
 *
 * For deals whose FIRST move into Closed Won was in the configured month, restore role fields to the
 * most-recent post-close Corgi Corp holder when they've since been changed to a non-Corgi-Corp person.
 */
export async function backfillFn1Page({ apply = false, after } = {}) {
  const corp = new Set((await corgiCorpOwnerIds()).map(String));
  const [monthStart, monthEnd] = monthBoundsMs(FN1_BACKFILL_YEAR, FN1_BACKFILL_MONTH, TIMEZONE);

  const filterGroups = [{ filters: [
    { propertyName: 'hs_v2_date_entered_closedwon', operator: 'GTE', value: String(monthStart) },
  ] }];
  const page = await searchDeals(filterGroups, ['dealname', ...ROLE_PROPS], 100, after);
  const candidates = page.results || [];
  const nextAfter = page.paging?.next?.after || null;

  const changes = [];
  let qualifying = 0;
  for (const d of candidates) {
    const hist = await getDealHistory(d.id, ['dealstage', ...ROLE_PROPS]);
    const h = hist.propertiesWithHistory || {};

    const closedTimes = (h.dealstage || []).filter((e) => e.value === CLOSEDWON).map((e) => Date.parse(e.timestamp));
    if (!closedTimes.length) continue;
    const firstClosedTs = Math.min(...closedTimes);
    if (firstClosedTs < monthStart || firstClosedTs >= monthEnd) continue; // first close not in target month
    qualifying++;

    for (const field of ROLE_PROPS) {
      const current = d.properties[field] ?? null;
      if (current && corp.has(String(current))) continue; // currently Corgi Corp -> leave

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

  let applied = 0;
  if (apply && changes.length) {
    const byDeal = {};
    for (const c of changes) (byDeal[c.deal] ||= {})[c.field] = c.to;
    for (const [deal, set] of Object.entries(byDeal)) {
      try {
        await updateDeal(deal, set);
        for (const [k, v] of Object.entries(set)) markSelfWrite(deal, k, v);
        await logAction({ fn: 'fn1', dealId: deal, property: Object.keys(set).join(','),
          newValue: Object.values(set).join(','), note: 'backfill: restored Corgi Corp owner(s)' });
        applied++;
      } catch (e) { console.error('[backfill] failed on', deal, e.message); }
    }
  }

  return {
    month: `${FN1_BACKFILL_YEAR}-${String(FN1_BACKFILL_MONTH).padStart(2, '0')}`,
    pageScanned: candidates.length, qualifying,
    changes: apply ? undefined : changes,
    totalChanges: changes.length, applied: apply ? applied : undefined,
    nextAfter,
  };
}
