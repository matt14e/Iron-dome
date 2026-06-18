import {
  SOURCE_PROP, INBOUND_VALUE, REVERT_DELAY_MS, TOGGLES,
  INBOUND_INTEGRATION_APP_IDS, INBOUND_INTEGRATION_NAMES,
} from './config.js';
import { getDeal, getObject, getAssociatedIds, updateDeal } from './hubspot.js';
import { isCorgiTechOwner } from './teams.js';
import { enqueueRevert, isEnabled, isPinned, logAction } from './db.js';
import { markSelfWrite, wasSelfWrite } from './selfWrites.js';

const SOURCE_FIELDS = ['hs_analytics_source_data_1', 'hs_analytics_source_data_2', 'hs_object_source_detail_1'];

/** Does a record's source fields indicate it was created by Tail or Deep River? */
export function recordIsInboundSourced(props = {}) {
  if (props.hs_analytics_source_data_1 === 'INTEGRATION'
      && INBOUND_INTEGRATION_APP_IDS.has(String(props.hs_analytics_source_data_2))) {
    return true;
  }
  const name = String(props.hs_object_source_detail_1 || '').trim().toLowerCase();
  return INBOUND_INTEGRATION_NAMES.has(name);
}

/** Is this deal a Corgi Tech deal? (owner ∈ Corgi Tech team) */
async function isCorgiTechDeal(deal) {
  return isCorgiTechOwner(deal?.properties?.hubspot_owner_id);
}

/**
 * Inbound if the deal, OR any associated contact/company, was created by Tail/Deep River,
 * OR the deal is pinned via the UI.
 */
async function dealQualifiesInbound(dealId, deal) {
  if (await isPinned(dealId)) return true;
  if (recordIsInboundSourced(deal.properties)) return true;

  const [contactIds, companyIds] = await Promise.all([
    getAssociatedIds(dealId, 'contacts'),
    getAssociatedIds(dealId, 'companies'),
  ]);
  for (const [type, ids] of [['contacts', contactIds], ['companies', companyIds]]) {
    for (const id of ids) {
      const obj = await getObject(type, id, SOURCE_FIELDS);
      if (recordIsInboundSourced(obj.properties)) return true;
    }
  }
  return false;
}

/** Set source to Inbound if a qualifying Corgi Tech deal isn't already there. */
export async function ensureInbound(dealId) {
  if (!(await isEnabled(TOGGLES.fn2))) return false;
  const deal = await getDeal(dealId, ['hubspot_owner_id', SOURCE_PROP, ...SOURCE_FIELDS]);
  if (!(await isCorgiTechDeal(deal))) return false;
  if (!(await dealQualifiesInbound(dealId, deal))) return false;

  const current = deal.properties[SOURCE_PROP];
  if (current === INBOUND_VALUE) return false;

  await updateDeal(dealId, { [SOURCE_PROP]: INBOUND_VALUE });
  markSelfWrite(dealId, SOURCE_PROP, INBOUND_VALUE);
  await logAction({ fn: 'fn2', dealId, property: SOURCE_PROP, oldValue: current, newValue: INBOUND_VALUE, note: 'set inbound' });
  console.log(`[fn2] set deal ${dealId} source ${current} -> Inbound`);
  return true;
}

/** Webhook: source changed. If a qualifying deal moved off Inbound, queue a revert. */
export async function handleSourceChange({ dealId, newValue, actorUserId }) {
  if (!(await isEnabled(TOGGLES.fn2))) return;
  if (newValue === INBOUND_VALUE) return; // already correct
  if (wasSelfWrite(dealId, SOURCE_PROP, newValue)) return;

  const deal = await getDeal(dealId, ['hubspot_owner_id', SOURCE_PROP, ...SOURCE_FIELDS]);
  if (!(await isCorgiTechDeal(deal))) return;
  if (!(await dealQualifiesInbound(dealId, deal))) return;

  await enqueueRevert({
    dealId,
    property: SOURCE_PROP,
    target: INBOUND_VALUE,
    reason: `fn2: actor (${actorUserId ?? 'unknown'}) changed source to ${newValue}; restoring Inbound`,
    dueAt: new Date(Date.now() + REVERT_DELAY_MS),
  });
  console.log(`[fn2] queued revert deal ${dealId} source -> Inbound (was ${newValue})`);
}
