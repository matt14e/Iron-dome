import {
  EMILY_OWNER_ID, FN3_ELIGIBLE_STAGE, FN3_STAGE_ENTERED_DATE_PROP, FN3_MIN_AGE_DAYS,
  FN3_DEFAULT_DAILY_COUNT, TIMEZONE, TOGGLES,
} from './config.js';
import { searchDeals, updateDeal } from './hubspot.js';
import { corgiTechOwnerIds } from './teams.js';
import { isEnabled, getConfig, logAction } from './db.js';
import { markSelfWrite } from './selfWrites.js';
import { shuffle, startOfMonthMs } from './util.js';

const PROPS = ['dealname', 'hubspot_owner_id', 'bdr', 'account_manager', FN3_STAGE_ENTERED_DATE_PROP];

/** Find all eligible Closed Won Corgi Tech deals entered this month, ≥2 days ago. */
async function findEligible() {
  const techOwners = await corgiTechOwnerIds();
  if (techOwners.length === 0) return [];

  const startMs = startOfMonthMs(TIMEZONE);
  const cutoffMs = Date.now() - FN3_MIN_AGE_DAYS * 24 * 60 * 60 * 1000;
  if (cutoffMs < startMs) return []; // too early in the month for anything to be ≥2 days old

  const filterGroups = [{
    filters: [
      { propertyName: 'dealstage', operator: 'EQ', value: FN3_ELIGIBLE_STAGE },
      { propertyName: 'hubspot_owner_id', operator: 'IN', values: techOwners },
      { propertyName: FN3_STAGE_ENTERED_DATE_PROP, operator: 'GTE', value: String(startMs) },
      { propertyName: FN3_STAGE_ENTERED_DATE_PROP, operator: 'LTE', value: String(cutoffMs) },
    ],
  }];

  const deals = [];
  let after;
  do {
    const page = await searchDeals(filterGroups, PROPS, 100, after);
    deals.push(...(page.results || []));
    after = page.paging?.next?.after;
  } while (after && deals.length < 10000);

  // Skip deals already fully assigned to Emily.
  return deals.filter((d) => {
    const p = d.properties;
    return !(p.hubspot_owner_id === EMILY_OWNER_ID && p.bdr === EMILY_OWNER_ID && p.account_manager === EMILY_OWNER_ID);
  });
}

/** Reassign one deal's BDR + Account Manager + owner to Emily. */
async function assignToEmily(deal) {
  const props = { hubspot_owner_id: EMILY_OWNER_ID, bdr: EMILY_OWNER_ID, account_manager: EMILY_OWNER_ID };
  await updateDeal(deal.id, props);
  for (const [k, v] of Object.entries(props)) markSelfWrite(deal.id, k, v);
  await logAction({
    fn: 'fn3', dealId: deal.id, property: 'bdr,account_manager,hubspot_owner_id',
    newValue: EMILY_OWNER_ID, note: `reassigned "${deal.properties.dealname || ''}" to Emily Yuan`,
  });
}

/** Daily job: pick N random eligible deals and reassign them. */
export async function runDailyReassignment({ trigger = 'cron' } = {}) {
  if (!(await isEnabled(TOGGLES.fn3))) {
    console.log('[fn3] disabled — skipping');
    return { skipped: true };
  }
  const count = Number(await getConfig(TOGGLES.fn3Count)) || FN3_DEFAULT_DAILY_COUNT;

  const eligible = await findEligible();
  const chosen = shuffle(eligible).slice(0, count);
  console.log(`[fn3] ${trigger}: ${eligible.length} eligible, reassigning ${chosen.length}`);

  let ok = 0;
  for (const deal of chosen) {
    try { await assignToEmily(deal); ok++; }
    catch (e) { console.error(`[fn3] failed on deal ${deal.id}:`, e.message); }
  }
  return { eligible: eligible.length, reassigned: ok };
}
