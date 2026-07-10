import { ROLE_PROPS, REVERT_DELAY_MS, TOGGLES, EXCLUDED_INTEGRATION_IDS } from './config.js';
import { getDealPropertyHistory } from './hubspot.js';
import { isCorgiCorpActor, isCorgiCorpOwnerValue } from './teams.js';
import { enqueueRevert, isEnabled, recordEnemy, isExempt } from './db.js';
import { wasSelfWrite } from './selfWrites.js';

/**
 * Function 1 — lock BDR / Account Manager / Deal owner (AE).
 * Revert ONLY when a non-Corgi-Corp actor displaces a Corgi Corp member; restore the prior value.
 */
export async function handleRoleChange({ dealId, property, newValue, actorUserId }) {
  if (!ROLE_PROPS.includes(property)) return;
  if (!(await isEnabled(TOGGLES.fn1))) return;
  if (wasSelfWrite(dealId, property, newValue)) return; // our own edit echoing back
  if (await isExempt(dealId)) return; // deal explicitly excluded from the Corp lock

  // Recover the previous value + confirm the actor from property history (most-recent first).
  const data = await getDealPropertyHistory(dealId, property);
  const history = data?.propertiesWithHistory?.[property] || [];
  const latest = history[0];
  const previous = history[1];

  const actor = actorUserId ?? latest?.sourceId ?? null;

  // A Corgi Corp member may freely change these fields.
  if (await isCorgiCorpActor(actor)) return;

  const prevValue = previous?.value ?? null;

  // Only protect assignments that belonged to a Corgi Corp member.
  if (!(await isCorgiCorpOwnerValue(prevValue))) return;

  await enqueueRevert({
    dealId,
    property,
    target: prevValue,
    reason: `fn1: non-Corgi-Corp actor (${actor ?? 'unknown'}) changed ${property}; restoring ${prevValue}`,
    dueAt: new Date(Date.now() + REVERT_DELAY_MS),
  });
  console.log(`[fn1] queued revert deal ${dealId} ${property} -> ${prevValue} (actor ${actor})`);

  // Passive enemy detection: if an integration made the displacing change, record it.
  if (latest?.sourceType === 'INTEGRATION' && !EXCLUDED_INTEGRATION_IDS.has(String(latest.sourceId))) {
    try {
      if (await recordEnemy(latest.sourceId, dealId)) {
        console.warn(`[enemy] NEW integration reassigning Corgi Corp deals: app ${latest.sourceId}`);
      }
    } catch (e) { console.error('[enemy] record failed:', e.message); }
  }
}
