# Corgi HubSpot Automation — Build Spec

Status: **Draft for review** · Last updated: 2026-06-17

A small always-on service that watches HubSpot deals and enforces three rules. It is
deterministic code — **it uses zero Claude/LLM credits to run.** Claude is only used to build it.

---

## 1. Architecture

- **Host:** Railway (Hobby, ~$5/mo, always-on by default — does not sleep).
- **Runtime:** Node.js (TypeScript) single service.
- **Database:** Railway Postgres (toggles, pinned deals, prior-value cache, pending reverts, audit log).
- **HubSpot access:** one **Private App** token (this is separate from the MCP connection used during design).
- **Change detection:** HubSpot **webhook subscriptions** → service receives property-change events
  including the **actor** (who made the change) and old/new values.
- **Timers:** a 60-second internal loop processes the "pending revert" queue; a daily cron runs Function 3.
- **UI:** minimal web page served by the same service (paste-a-deal-URL + three on/off switches + activity log).

### Loop-prevention (critical)
The service edits deals via its own Private App, so its own writes also fire webhooks.
Every event whose **actor == our Private App** is ignored, so reverts never trigger reverts.

### Restart safety
Pending reverts live in Postgres, not memory, so a deploy/restart never drops an in-flight revert.

---

## 2. HubSpot Private App scopes

Settings → Integrations → Private Apps → Create. Required scopes:

- `crm.objects.deals.read`, `crm.objects.deals.write`
- `crm.objects.contacts.read`
- `crm.objects.companies.read`
- `crm.objects.owners.read`
- `settings.users.teams.read`  ← lets the service read Corgi Corp / Corgi Tech membership live
- Webhooks (configured in the app's Webhooks tab; target = the Railway public URL)

---

## 3. Confirmed HubSpot field mapping

| Concept | Property | Notes |
|---|---|---|
| BDR | `bdr` (enumeration of people) | value = owner ID, e.g. Emily = `161706311` |
| Account Manager | `account_manager` (enumeration of people) | same value space as `bdr` |
| Account Executive (AE) | `hubspot_owner_id` (standard Deal owner) | AE == deal owner |
| Deal source | `source` (enumeration) | target value is **`Inbound`** (capitalized) |
| Inbound integration signal (primary) | `hs_analytics_source_data_2` (when `hs_analytics_source_data_1 == "INTEGRATION"`) | integration **app ID**: Tail = `31988037`, Deep River = `35918668` |
| Inbound integration signal (backup) | `hs_object_source_detail_1` | integration name string: `Tail`, `Deep-River` (note hyphen) |
| Emily Yuan | owner ID `161706311` | active |

**Rosters are read live from HubSpot Teams** — no static lists to maintain:
- **Corgi Corp** team → allowed editors for Function 1.
- **Corgi Tech** team → defines which deals Functions 2 & 3 act on (deal owner ∈ team).

---

## 4. Function 1 — Lock BDR / Account Manager / Deal owner (AE)

**Watches:** `bdr`, `account_manager`, `hubspot_owner_id` on all deals.

**Rule (confirmed):** revert **only when an edit displaces a Corgi Corp member** — i.e. the field's
**prior value was a Corgi Corp member** AND the editor is **not** a Corgi Corp member. Restore the
exact prior value. Edits by Corgi Corp members are always allowed.

**Flow:**
1. Webhook fires for one of the three fields.
2. Ignore if actor is our Private App (loop guard) or actor ∈ Corgi Corp.
3. If prior value was a Corgi Corp member and actor ∉ Corgi Corp → enqueue a revert to the prior value, due in 60s.
4. The 60s loop applies the revert and writes an audit-log row.

**Toggle:** `function1_enabled`.

### 4a. Function 1 — one-time first-run backfill (run at launch)

A separate, deliberate, **run-once** reconciliation (NOT part of the live webhook path). Restores
Corgi Corp ownership that was changed away on already-closed deals before the bot was watching.

**For every deal that has reached Closed Won** (`closedwon`; the deleted "Contract Signed" stage
can't be reliably identified, so it's excluded):
- For each of the 3 roles (`bdr`, `account_manager`, `hubspot_owner_id`), read the property history.
- Consider only history entries **at/after** the Closed Won date (`hs_v2_date_entered_closedwon`).
- A historical value counts as "Corgi Corp" if that owner ID is **currently** a Corgi Corp member.
- If a Corgi Corp member held the role post-close **and** the role is **currently** held by a
  **non**-Corgi-Corp person → set the role to the **most recent** post-close Corgi Corp holder.
- If the role is **currently** held by any Corgi Corp member → leave it unchanged.

**Conflict with Function 3:** none. Fn1 keys off Corgi Corp, Fn3 only moves Corgi Tech-owned deals
(disjoint teams). Running the backfill first moves Corgi-Corp-historical deals off Corgi Tech
ownership, so Fn3 won't select them.

**Cost/safety:** API-heavy — ~1 history read per closed-won deal (potentially thousands). Build with a
**dry-run preview** (report every proposed role change before applying), throttle to respect the
account-wide daily API limit, and run deliberately with quota headroom.

---

## 5. Function 2 — Force Corgi Tech inbound deals to `source = Inbound`

**Scope:** deals whose **owner ∈ Corgi Tech** team. (Hard-restricted to Corgi Tech.)

**A record counts as Tail/Deep-River-sourced if EITHER:**
- `hs_analytics_source_data_2` ∈ { `31988037` (Tail), `35918668` (Deep River) } with `hs_analytics_source_data_1 == "INTEGRATION"` (**primary** — survives indirect creation), or
- `hs_object_source_detail_1` ∈ { `Tail`, `Deep-River` } (case-insensitive, **backup**).

**A deal is "inbound" if ANY of:**
- the **deal** itself is Tail/Deep-River-sourced, or
- an associated **contact** is Tail/Deep-River-sourced, or
- an associated **company** is Tail/Deep-River-sourced, or
- the deal is **pinned via the UI**.

**Behavior:**
- On qualifying deals, ensure `source == Inbound`; if not, set it.
- Webhook on `source`: if a qualifying/pinned deal is changed to anything else → revert to `Inbound` within 60s.
- A periodic sweep also catches deals that became inbound without a `source` change.

**UI pin:** paste a deal URL → service extracts the deal ID → stores a pin row → that deal is held at
`Inbound` indefinitely until unpinned (pins are also restricted to Corgi Tech deals).

**Toggle:** `function2_enabled`.

> Tail vs Deep River are treated identically. Both confirmed: Tail = app ID `31988037` / string `Tail`;
> Deep River = app ID `35918668` / string `Deep-River`. App ID is the primary signal because it survives
> indirect creation (e.g. a company auto-created by the integration shows the app ID but not the name string).

---

## 6. Function 3 — Daily randomized reassignment to Emily Yuan

**Eligible deal (all must hold):**
- owner ∈ **Corgi Tech** team, and
- stage is **Closed Won** (`closedwon`) — the old "Contract Signed" stage was deleted and leaves no
  detectable date property, so it's excluded for now (optional future enhancement via stage-history), and
- `hs_v2_date_entered_closedwon` (date **first moved** to Closed Won) is in the **current calendar month**
  (US/Eastern, the account time zone), and
- that move was **≥ 2 days ago** (relative to run time), and
- not already fully assigned to Emily across all three fields.

**Action:** pick **N = 10** eligible deals **uniformly at random** (N is a config value), and set
`bdr`, `account_manager`, and `hubspot_owner_id` all to Emily Yuan (`161706311`). Audit-log each.

**Schedule:** once daily at **22:00 America/Denver** (10:00 PM Mountain, DST-aware). Run time configurable.

**Toggle:** `function3_enabled`. Plus config: `function3_daily_count` (default 10).

---

## 7. Config & toggles

Stored in DB, editable from the UI:
- `function1_enabled`, `function2_enabled`, `function3_enabled` (on/off each)
- `function3_daily_count` (default 10)
- `function3_run_time` — default **22:00 America/Denver** (10 PM Mountain, DST-aware)

---

## 8. Data model (Postgres)

- `config` — key/value for the toggles and settings above.
- `prior_values` — last-known-good value per (deal_id, field) for Function 1 reverts.
- `pinned_deals` — deal IDs pinned to Inbound via the UI.
- `pending_reverts` — queued reverts with `due_at`; drained by the 60s loop.
- `audit_log` — every automated action (what, which deal, old→new, who triggered, when).

---

## 9. Setup steps (when we build)

1. Create the HubSpot Private App with the scopes in §2; copy the token.
2. Create a GitHub repo; I scaffold the service into it.
3. Create a Railway project from the repo + add a Postgres plugin.
4. Set env vars (HubSpot token, DB URL, webhook secret).
5. Point HubSpot webhook subscriptions at the Railway URL.
6. Flip Function 1/2/3 toggles on one at a time and watch the audit log.

---

## 10. Open items to resolve at build time

- Exact **pipeline + stage internal IDs** for "closed won" and "contract signed" (and the
  `hs_date_entered_<stage>` property used for "first moved" date).
- Confirm `bdr` / `account_manager` enumeration values equal owner IDs (Emily's match — verify the rest).

---

## 11. Cost

- Railway Hobby: ~$5/mo (includes $5 usage credit; tiny service + small Postgres should sit near the floor).
- HubSpot: $0 (uses existing Sales Hub Pro + a free Private App).
- Claude credits to **run**: $0.

---

## 12. Process note (non-technical)

Functions 1 and 3 silently revert colleagues' edits and reassign closed-won deals to one person.
If people don't know it's running, this can cause confusion or disputes. That's a business/process
decision for you — flagged so it's on the record before launch.
