import crypto from 'node:crypto';
import { config, ROLE_PROPS, SOURCE_PROP } from './config.js';
import { handleRoleChange } from './function1.js';
import { handleSourceChange } from './function2.js';

/**
 * Validate HubSpot's X-HubSpot-Signature-v3 header.
 * Off by default (VERIFY_WEBHOOKS=false) so you can wire things up first; turn on once the
 * signing secret is configured.
 */
export function verifySignature(req) {
  if (!config.verifyWebhooks) return true;
  const signature = req.get('X-HubSpot-Signature-v3');
  const timestamp = req.get('X-HubSpot-Request-Timestamp');
  if (!signature || !timestamp) return false;
  // reject stale (>5 min) requests
  if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000) return false;

  const base = `${req.method}${req.protocol}://${req.get('host')}${req.originalUrl}${req.rawBody}${timestamp}`;
  const hash = crypto.createHmac('sha256', config.hubspotClientSecret).update(base).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  } catch {
    return false;
  }
}

/** Normalize the actor id from a webhook event's sourceId (e.g. "userId:123" -> "123"). */
function actorFromEvent(ev) {
  const raw = ev.sourceId ?? ev.userId ?? null;
  if (raw == null) return null;
  const s = String(raw);
  return s.includes(':') ? s.split(':').pop() : s;
}

/** Dispatch a batch of HubSpot webhook events to the relevant function handlers. */
export async function dispatchEvents(events = []) {
  for (const ev of events) {
    if (ev.subscriptionType !== 'deal.propertyChange') continue;
    const payload = {
      dealId: String(ev.objectId),
      property: ev.propertyName,
      newValue: ev.propertyValue ?? null,
      actorUserId: actorFromEvent(ev),
      changeSource: ev.changeSource,
    };
    try {
      if (ROLE_PROPS.includes(ev.propertyName)) await handleRoleChange(payload);
      else if (ev.propertyName === SOURCE_PROP) await handleSourceChange(payload);
    } catch (e) {
      console.error('[webhook] handler error:', e.message);
    }
  }
}
