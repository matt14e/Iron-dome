import { ROLE_PROPS, SOURCE_PROP, TOGGLES } from './config.js';
import { getDeal, updateDeal } from './hubspot.js';
import { dueReverts, deleteRevert, isEnabled, logAction, isExempt } from './db.js';
import { markSelfWrite } from './selfWrites.js';

/**
 * Drains the pending-revert queue. Runs on a short interval so any queued revert fires
 * ~60s after the offending change (the queue row's due_at). Re-checks current state first,
 * so a change already corrected by a human is skipped.
 */
export async function processDueReverts() {
  let rows;
  try { rows = await dueReverts(); } catch (e) { console.error('[revert] query failed:', e.message); return; }

  for (const r of rows) {
    try {
      const isRole = ROLE_PROPS.includes(r.property);
      const toggle = isRole ? TOGGLES.fn1 : TOGGLES.fn2;
      if (!(await isEnabled(toggle))) { await deleteRevert(r.id); continue; }
      if (isRole && (await isExempt(r.deal_id))) { await deleteRevert(r.id); continue; } // exempted after queueing

      const deal = await getDeal(r.deal_id, [r.property]);
      const current = deal.properties[r.property] ?? null;
      const target = r.target ?? null;

      if (current !== target) {
        await updateDeal(r.deal_id, { [r.property]: target });
        markSelfWrite(r.deal_id, r.property, target);
        await logAction({
          fn: isRole ? 'fn1' : 'fn2',
          dealId: r.deal_id, property: r.property,
          oldValue: current, newValue: target, note: r.reason,
        });
        console.log(`[revert] deal ${r.deal_id} ${r.property}: ${current} -> ${target}`);
      }
      await deleteRevert(r.id);
    } catch (e) {
      console.error(`[revert] failed on ${r.deal_id}/${r.property}:`, e.message);
      // leave the row; it will retry next tick
    }
  }
}
