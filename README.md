# Corgi HubSpot Bot

Always-on service that enforces three rules on HubSpot deals. Deterministic — **no LLM/Claude
credits at runtime.** See [SPEC.md](./SPEC.md) for the full design.

1. **Lock roles** — reverts BDR / Account Manager / Deal owner edits made by non-Corgi-Corp people
   (only when they displace a Corgi Corp member), within ~1 minute.
2. **Force Inbound** — Corgi Tech deals created by Tail / Deep River (deal, contact, or company), plus
   any deal pinned in the UI, are held at `source = Inbound`.
3. **Daily reassignment** — at 10 PM Mountain, picks N random (default 10) Closed Won Corgi Tech deals
   entered this month (≥2 days ago) and assigns BDR + AM + owner to Emily Yuan.

Each function has an independent on/off switch in the dashboard.

## Stack
Node 20+ (ESM, no build step) · Express · Postgres · `node-cron`. Hosted on Railway.

## Deploy (Railway)
1. Push this repo to GitHub.
2. Railway → New Project → Deploy from GitHub repo → select it.
3. Add a **Postgres** plugin (auto-sets `DATABASE_URL`).
4. Set service **Variables** (see `.env.example`): `HUBSPOT_TOKEN`, `UI_PASSWORD`, optionally
   `TEAM_CORGI_CORP` / `TEAM_CORGI_TECH` if your team names differ.
5. Settings → Networking → **Generate Domain** to get a public URL.
6. In your HubSpot Private App → **Webhooks**: set the target URL to `https://<your-domain>/webhooks`
   and create `deal.propertyChange` subscriptions for: `bdr`, `account_manager`, `hubspot_owner_id`, `source`.
7. Open `https://<your-domain>/`, enter `UI_PASSWORD`, and flip functions on one at a time.

## Local dev
```bash
cp .env.example .env   # fill in HUBSPOT_TOKEN + a local DATABASE_URL
npm install
npm run dev
```

## Endpoints
- `POST /webhooks` — HubSpot webhook receiver
- `GET /` — dashboard · `GET /health`
- `POST /api/run-fn3` — manually trigger Function 3 (password-protected; useful for testing)

## Verify against your account before going live
- **Team names** match `Corgi Corp` / `Corgi Tech` exactly (Settings → Users & Teams → Teams).
- **Webhook signature**: starts disabled (`VERIFY_WEBHOOKS=false`). Once confirmed working, set the
  signing secret and `VERIFY_WEBHOOKS=true`.
- **userId vs ownerId**: `teams.js` bridges them via the owners list; confirm reverts target the right
  people on a test deal before enabling Function 1 broadly.
- Start with Function 2 (lowest risk), then 1, then 3.

## Known follow-ups
- Detecting the deleted "Contract Signed" stage for Function 3 (currently Closed Won only).
- Confirm Deep River's exact `hs_object_source_detail_1` string in the wild (app-ID match already covers it).
