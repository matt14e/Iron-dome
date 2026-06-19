import { config } from './config.js';

const BASE = 'https://api.hubapi.com';

async function hs(path, { method = 'GET', body, query } = {}) {
  const url = new URL(BASE + path);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${config.hubspotToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot ${method} ${path} -> ${res.status}: ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

/** Fetch a deal with the given properties. */
export function getDeal(id, properties) {
  return hs(`/crm/v3/objects/deals/${id}`, { query: { properties: properties.join(',') } });
}

/**
 * Fetch a single property WITH history (most-recent first). Used by Function 1 to recover the
 * previous value and identify who made the latest change.
 */
export function getDealPropertyHistory(id, property) {
  return hs(`/crm/v3/objects/deals/${id}`, { query: { propertiesWithHistory: property } });
}

/** Fetch multiple properties WITH history in one call (for diagnostics). */
export function getDealHistory(id, properties) {
  return hs(`/crm/v3/objects/deals/${id}`, { query: { propertiesWithHistory: properties.join(',') } });
}

/** Patch deal properties. Pass { prop: null } to clear a field. */
export function updateDeal(id, properties) {
  return hs(`/crm/v3/objects/deals/${id}`, { method: 'PATCH', body: { properties } });
}

/** Generic object fetch (contacts/companies) for inbound-source checks. */
export function getObject(objectType, id, properties) {
  return hs(`/crm/v3/objects/${objectType}/${id}`, { query: { properties: properties.join(',') } });
}

/** Associated object IDs of a given type for a deal (e.g. 'contacts', 'companies'). */
export async function getAssociatedIds(dealId, toObjectType) {
  const data = await hs(`/crm/v3/objects/deals/${dealId}/associations/${toObjectType}`);
  return (data?.results || []).map((r) => r.toObjectId ?? r.id);
}

/** Search deals. filterGroups per HubSpot search API. */
export function searchDeals(filterGroups, properties, limit = 100, after) {
  return hs(`/crm/v3/objects/deals/search`, {
    method: 'POST',
    body: { filterGroups, properties, limit, after },
  });
}

/** All owners (paginated) — maps userId <-> ownerId. */
export async function listOwners() {
  const owners = [];
  let after;
  do {
    const page = await hs(`/crm/v3/owners`, { query: { limit: '100', ...(after ? { after } : {}) } });
    owners.push(...(page.results || []));
    after = page.paging?.next?.after;
  } while (after);
  return owners; // each: { id (ownerId), userId, email, firstName, lastName, archived }
}

/** Teams with their member userIds. */
export async function listTeams() {
  const data = await hs(`/settings/v3/users/teams`);
  return data?.results || []; // each: { id, name, userIds:[], secondaryUserIds:[] }
}
