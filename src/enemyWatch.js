import { ROLE_PROPS, EXCLUDED_INTEGRATION_IDS, TIMEZONE } from './config.js';
import { searchDeals, getDealHistory } from './hubspot.js';
import { corgiCorpOwnerIds, corgiTechOwnerIds } from './teams.js';
import { recordEnemy } from './db.js';
import { sleep, startOfDayMs } from './util.js';

/**
 * Deals whose BDR / AM / owner was changed today from a Corgi Corp member to a non-Corgi-Corp person.
 * Scans the most-recently-modified deals (attacks bump last-modified, so they surface first).
 * Returns per-deal grouping with the apps/actors responsible and flip counts.
 */
export async function todayDisplacements({ limit = 250 } = {}) {
  const corp = new Set((await corgiCorpOwnerIds()).map(String));
  const tech = new Set((await corgiTechOwnerIds()).map(String));
  const start = startOfDayMs(TIMEZONE);

  const search = await searchDeals([], ['dealname'], limit, undefined,
    [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }]);
  const deals = search.results || [];

  const byDeal = {};
  for (const d of deals) {
    const hist = await getDealHistory(d.id, ROLE_PROPS);
    await sleep(120);
    const h = hist.propertiesWithHistory || {};
    for (const field of ROLE_PROPS) {
      const entries = h[field] || []; // most-recent first
      for (let i = 0; i < entries.length - 1; i++) {
        const cur = entries[i], prev = entries[i + 1];
        if (Date.parse(cur.timestamp) < start) break; // desc order — past today, stop this field
        const displacedCorp = prev.value && corp.has(String(prev.value));
        const toNonCorp = !cur.value || !corp.has(String(cur.value));
        if (displacedCorp && toNonCorp) {
          const g = (byDeal[d.id] ||= { deal: d.id, name: d.properties.dealname, flips: 0, apps: new Set(),
            fields: new Set(), from: new Set(), to: new Set(), toTech: false, last: cur.timestamp });
          g.flips++;
          g.fields.add(field);
          g.from.add(String(prev.value));
          if (cur.value) { g.to.add(String(cur.value)); if (tech.has(String(cur.value))) g.toTech = true; }
          g.apps.add(cur.sourceType === 'INTEGRATION' ? `app ${cur.sourceId}` : cur.sourceType);
          if (Date.parse(cur.timestamp) > Date.parse(g.last)) g.last = cur.timestamp;
        }
      }
    }
  }

  const results = Object.values(byDeal).map((g) => ({
    deal: g.deal, name: g.name, flips: g.flips, last: g.last,
    fields: [...g.fields], apps: [...g.apps], from: [...g.from], to: [...g.to], toTech: g.toTech,
  })).sort((a, b) => b.flips - a.flips);

  return { since: new Date(start).toISOString(), scanned: deals.length, dealCount: results.length, deals: results };
}

/**
 * Proactive enemy watch: scan recently-modified deals for INTEGRATION changes that displaced a
 * Corgi Corp member from a role (i.e. moved it to a non-Corgi-Corp value). Records the offending
 * app ids; returns any newly-detected ones. Ignores our own app.
 */
export async function scanForEnemies({ limit = 80 } = {}) {
  const corp = new Set((await corgiCorpOwnerIds()).map(String));
  const search = await searchDeals([], ['dealname'], limit, undefined,
    [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }]);
  const deals = search.results || [];

  const found = {}; // appId -> { hits, sampleDeal }
  for (const d of deals) {
    const hist = await getDealHistory(d.id, ROLE_PROPS);
    await sleep(120);
    const h = hist.propertiesWithHistory || {};
    for (const field of ROLE_PROPS) {
      const entries = h[field] || []; // most-recent first
      for (let i = 0; i < entries.length - 1; i++) {
        const cur = entries[i], prev = entries[i + 1];
        const displacedCorp = prev.value && corp.has(String(prev.value));
        const toNonCorp = !cur.value || !corp.has(String(cur.value));
        if (cur.sourceType === 'INTEGRATION' && !EXCLUDED_INTEGRATION_IDS.has(String(cur.sourceId)) && displacedCorp && toNonCorp) {
          (found[cur.sourceId] ||= { hits: 0, sampleDeal: d.id }).hits++;
        }
      }
    }
  }

  const newEnemies = [];
  for (const [appId, info] of Object.entries(found)) {
    if (await recordEnemy(appId, info.sampleDeal)) newEnemies.push(appId);
  }
  if (newEnemies.length) console.warn(`[enemy-watch] NEW integration(s) reassigning Corgi Corp deals: ${newEnemies.join(', ')}`);
  return { scanned: deals.length, integrations: found, newEnemies };
}
