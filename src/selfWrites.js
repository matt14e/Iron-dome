/**
 * Short-lived guard so the bot ignores the webhook echo of its OWN edits.
 * Without this, every revert would trigger another revert (infinite loop).
 */
const TTL_MS = 2 * 60 * 1000;
const seen = new Map(); // key -> expiry ms

const key = (dealId, property, value) => `${dealId}:${property}:${value ?? ''}`;

export function markSelfWrite(dealId, property, value) {
  seen.set(key(dealId, property, value), Date.now() + TTL_MS);
}

/** Returns true (and consumes the marker) if this change was made by us. */
export function wasSelfWrite(dealId, property, value) {
  const k = key(dealId, property, value);
  const exp = seen.get(k);
  if (exp && exp > Date.now()) {
    seen.delete(k);
    return true;
  }
  return false;
}

// periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [k, exp] of seen) if (exp <= now) seen.delete(k);
}, TTL_MS).unref?.();
