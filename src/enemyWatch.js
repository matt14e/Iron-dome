import { ROLE_PROPS, EXCLUDED_INTEGRATION_IDS } from './config.js';
import { searchDeals, getDealHistory } from './hubspot.js';
import { corgiCorpOwnerIds } from './teams.js';
import { recordEnemy } from './db.js';
import { sleep } from './util.js';

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
