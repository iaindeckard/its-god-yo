/**
 * TEMPORARY hard block on customer transactions. While this is false, no
 * customer can reach Stripe: the landing "Get started" CTAs show "Coming soon",
 * /signup shows a coming-soon notice instead of the purchase flow, and
 * /api/setup-intent refuses to create a SetupIntent. Flip to true to re-open
 * signups (there is no way to be charged while this is false).
 */
export const PURCHASES_ENABLED = true;

/**
 * Gates Spanish as a selectable / advertised language. Flipped true 2026-09-01:
 * 18 of 30 September general-track dates carry a reviewed, approved Spanish
 * translation (12 remain flagged needs_review and are not approved — those
 * dates fall back to the no-silence General track at send time, same as any
 * other gap). While false: the signup language step offers English only and a
 * `?lang=es` param is ignored; the landing hides the "Español" toggle and the
 * "Español / RV1909" marketing badge. Nothing downstream requires Spanish (all
 * `lang === "es"` usage is conditional), so this only removes the option — it
 * doesn't break the flow.
 */
export const SPANISH_ENABLED = true;

/**
 * Sponsor Program visibility. DEPRIORITIZED 2026-08-01 in favor of the
 * Cornerstone Partner Program (zero sponsors / zero inquiries since ~2026-07-22).
 * While false, every PUBLIC sponsor surface is hidden: the homepage sponsor
 * rotator, all "Interested in sponsoring?" links/CTAs, the /sponsors thank-you
 * grid, and the /sponsor-inquiry form (both routes 404). The public /api/sponsors
 * and /api/sponsor-inquiry endpoints go dark too, so nothing is reachable via a
 * stale link or cached JS. This is "off for now," NOT "gone" — the admin surface
 * (/admin/sponsors), the igy_sponsors / igy_sponsor_inquiries tables, and all
 * schema are intentionally left intact so the program can be reactivated by
 * flipping this back to true. Do not delete sponsor code or data.
 */
export const SPONSORS_ENABLED = false;

/**
 * Cornerstone Partner Program public surfaces. While false, the public church
 * application/enrollment form is hidden: /cornerstone 404s and the public
 * POST /api/cornerstone/apply endpoint 404s, so no church can submit and nothing
 * is reachable via a stale link. The admin surface (/admin/cornerstone), the
 * churches / cornerstone_* tables, and the approval flow are unaffected — this
 * only gates the customer-facing intake. Default off until the program launches;
 * flip to true (same pattern as SPONSORS_ENABLED) to open enrollment.
 */
export const CORNERSTONE_ENABLED = true;

/**
 * Master switch for the day-14-21 "DM from Him" retention upsell cron
 * (/api/cron/dm-upsell). While false, the cron runs in DRY mode: it computes who
 * is in the window and would be prompted, and logs it, but sends NO SMS and writes
 * NO dm_upsell_log rows, so it can be deployed and observed harmlessly. Flip to true
 * ONLY after the upsell copy has final sign-off (it is preliminarily approved as a
 * concept, not as specific wording). Depends on the same Twilio config as the daily
 * send. Never enable in isolation of a working send path.
 */
export const DM_UPSELL_ENABLED = false;

/**
 * Master switch for the Stage 2 daily send (the /api/cron/daily-send tick).
 * While false, the cron runs in DRY mode: it still computes who is due and
 * whether approved content exists, but makes NO Twilio calls and writes NO
 * daily_send_log rows — so it can be deployed and observed harmlessly. Flip to
 * true ONLY after the full send path is verified AND Twilio toll-free
 * verification clears (locked sequencing: content+send verified → Twilio → then
 * this, then PURCHASES_ENABLED). Never enable this in isolation.
 */
export const DAILY_SEND_ENABLED = true;

/**
 * Holy Season add-on products (Christmastide / Advent / Eastertide / Lent). While
 * false, the feature fails closed at every layer:
 *   - the /seasons/manage toggle UI 404s (notFound), even with a valid token;
 *   - the enrollment/toggle path is blocked (toggleSeasonAction returns
 *     seasons_disabled; setSeasonEnrollment throws) — not just the crons;
 *   - the moving-date billing cron and the seasonal/climax send paths no-op.
 * Kept off until go-live inherits the same hard sequencing as the base product
 * (Twilio toll-free delivery live → daily-send verified → PURCHASES_ENABLED → then
 * this) AND SEASON_LINK_SECRET + the STRIPE_PRICE_SEASON_* prices are set in prod
 * (see docs/SEASONAL-ADDONS-BUILD-NOTES.md go-live checklist). Dormant-but-built.
 */
export const SEASONS_ENABLED = false;

/**
 * Customer-facing cause-promotion status page (/cause/status). While false the
 * public page is fully dark (returns notFound), regardless of any promotion's own
 * customer_facing_enabled flag. Two gates must BOTH be true to surface anything to a
 * customer: this global flag AND the specific promotion's customer_facing_enabled
 * column. Admin tracking (the /admin/cause-promotions widget) is unaffected by this
 * flag. Built now, kept dark until Iain enables it for a specific future promotion.
 */
export const CAUSE_PUBLIC_ENABLED = false;
