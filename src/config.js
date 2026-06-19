import 'dotenv/config';

/** Central configuration & constants confirmed against the HubSpot account. */
export const config = {
  hubspotToken: process.env.HUBSPOT_TOKEN,
  hubspotClientSecret: process.env.HUBSPOT_CLIENT_SECRET || '',
  verifyWebhooks: String(process.env.VERIFY_WEBHOOKS).toLowerCase() === 'true',
  databaseUrl: process.env.DATABASE_URL,
  port: Number(process.env.PORT || 3000),
  uiPassword: process.env.UI_PASSWORD || 'change-me',

  teamCorgiCorp: process.env.TEAM_CORGI_CORP || 'Corgi Corp',
  teamCorgiTech: process.env.TEAM_CORGI_TECH || 'Corgi Tech',
};

// --- Confirmed HubSpot field mapping (see SPEC.md) ---

/** The three role fields Function 1 protects. All hold owner IDs. */
export const ROLE_PROPS = ['bdr', 'account_manager', 'hubspot_owner_id'];

/** Deal source field + the one value we force for inbound deals. */
export const SOURCE_PROP = 'source';
export const INBOUND_VALUE = 'Inbound';

/** Emily Yuan — target of Function 3. */
export const EMILY_OWNER_ID = '161706311';

/** Inbound integration signals. App ID (primary) survives indirect record creation. */
export const INBOUND_INTEGRATION_APP_IDS = new Set(['31988037' /* Tail */, '35918668' /* Deep River */]);
export const INBOUND_INTEGRATION_NAMES = new Set(['tail', 'deep-river', 'deep river']); // lower-cased, backup signal

/** Function 3 eligibility. */
export const FN3_ELIGIBLE_STAGE = 'closedwon';
export const FN3_STAGE_ENTERED_DATE_PROP = 'hs_v2_date_entered_closedwon';
export const FN3_MIN_AGE_DAYS = 2;
export const FN3_DEFAULT_DAILY_COUNT = 10;

/** Scheduling / timing. */
export const TIMEZONE = 'America/New_York'; // US/Eastern — matches the HubSpot account time zone
export const FN3_CRON = '0 22 * * *'; // 10:00 PM US/Eastern
export const REVERT_DELAY_MS = 60 * 1000; // enforce "within 1 minute"
export const REVERT_LOOP_MS = 15 * 1000; // how often we drain the revert queue
export const SWEEP_INTERVAL_MS = 30 * 60 * 1000; // Function 2 proactive sweep cadence (when enabled) — kept long to conserve the account-wide daily API quota

/** Feature toggle keys (stored in DB `config` table). */
export const TOGGLES = {
  fn1: 'function1_enabled',
  fn2: 'function2_enabled',
  fn3: 'function3_enabled',
  fn3Count: 'function3_daily_count',
};

if (!config.hubspotToken) console.warn('[config] HUBSPOT_TOKEN is not set — HubSpot calls will fail.');
if (!config.databaseUrl) console.warn('[config] DATABASE_URL is not set — DB will fail to connect.');
