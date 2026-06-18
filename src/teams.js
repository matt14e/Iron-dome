import { config } from './config.js';
import { listOwners, listTeams } from './hubspot.js';

/**
 * Resolves Corgi Corp / Corgi Tech membership live from HubSpot, cached for a few minutes.
 *
 * Two id spaces matter:
 *  - userId  — identifies the *actor* who edited a deal (from webhook / property history).
 *  - ownerId — the value stored in bdr / account_manager / hubspot_owner_id.
 * Teams list members by userId; we bridge to ownerId via the owners list.
 */
const TTL_MS = 5 * 60 * 1000;
let cache = { at: 0, data: null };

async function build() {
  const [owners, teams] = await Promise.all([listOwners(), listTeams()]);

  const userIdToOwnerId = new Map();
  for (const o of owners) {
    if (o.userId != null) userIdToOwnerId.set(String(o.userId), String(o.id));
  }

  const byName = (name) =>
    teams.find((t) => (t.name || '').trim().toLowerCase() === name.trim().toLowerCase());

  const memberUserIds = (team) => {
    const ids = [...(team?.userIds || []), ...(team?.secondaryUserIds || [])];
    return new Set(ids.map(String));
  };
  const toOwnerIds = (userIds) => {
    const out = new Set();
    for (const uid of userIds) {
      const oid = userIdToOwnerId.get(uid);
      if (oid) out.add(oid);
      out.add(uid); // fallback: some accounts use equal ids
    }
    return out;
  };

  const corp = byName(config.teamCorgiCorp);
  const tech = byName(config.teamCorgiTech);

  if (!corp) console.warn(`[teams] Team "${config.teamCorgiCorp}" not found in HubSpot.`);
  if (!tech) console.warn(`[teams] Team "${config.teamCorgiTech}" not found in HubSpot.`);

  const corpUserIds = memberUserIds(corp);
  const techUserIds = memberUserIds(tech);

  return {
    corpFound: !!corp,
    techFound: !!tech,
    corpUserIds, // actor checks for Function 1
    corpOwnerIds: toOwnerIds(corpUserIds), // value checks for Function 1
    techOwnerIds: toOwnerIds(techUserIds), // deal-ownership checks for Functions 2 & 3
  };
}

async function get() {
  if (!cache.data || Date.now() - cache.at > TTL_MS) {
    cache = { at: Date.now(), data: await build() };
  }
  return cache.data;
}

export async function isCorgiCorpActor(userId) {
  if (userId == null) return false;
  return (await get()).corpUserIds.has(String(userId));
}
export async function isCorgiCorpOwnerValue(ownerId) {
  if (ownerId == null || ownerId === '') return false;
  return (await get()).corpOwnerIds.has(String(ownerId));
}
export async function isCorgiTechOwner(ownerId) {
  if (ownerId == null || ownerId === '') return false;
  return (await get()).techOwnerIds.has(String(ownerId));
}
export async function corgiTechOwnerIds() {
  return [...(await get()).techOwnerIds];
}

/** Read-only diagnostics: confirms HubSpot token works and both teams resolve. */
export async function getTeamDiagnostics() {
  cache = { at: 0, data: null }; // force a fresh fetch
  const d = await get();
  return {
    corgiCorp: { found: d.corpFound, members: d.corpUserIds.size, owners: d.corpOwnerIds.size },
    corgiTech: { found: d.techFound, owners: d.techOwnerIds.size, ownerIds: [...d.techOwnerIds] },
    emilyInCorgiTech: d.techOwnerIds.has('161706311'),
  };
}
