/**
 * TEMPORARY hard block on customer transactions. While this is false, no
 * customer can reach Stripe: the landing "Get started" CTAs show "Coming soon",
 * /signup shows a coming-soon notice instead of the purchase flow, and
 * /api/setup-intent refuses to create a SetupIntent. Flip to true to re-open
 * signups (there is no way to be charged while this is false).
 */
export const PURCHASES_ENABLED = false;

/**
 * Gates Spanish as a selectable / advertised language until a real reviewed
 * Spanish verse batch exists — same standard we hold English to. While false:
 * the signup language step offers English only and a `?lang=es` param is ignored;
 * the landing hides the "Español" toggle and the "Español / RV1909" marketing
 * badge. Nothing downstream requires Spanish (all `lang === "es"` usage is
 * conditional), so this only removes the option — it doesn't break the flow.
 */
export const SPANISH_ENABLED = false;

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
export const CORNERSTONE_ENABLED = false;

/**
 * Master switch for the Stage 2 daily send (the /api/cron/daily-send tick).
 * While false, the cron runs in DRY mode: it still computes who is due and
 * whether approved content exists, but makes NO Twilio calls and writes NO
 * daily_send_log rows — so it can be deployed and observed harmlessly. Flip to
 * true ONLY after the full send path is verified AND Twilio toll-free
 * verification clears (locked sequencing: content+send verified → Twilio → then
 * this, then PURCHASES_ENABLED). Never enable this in isolation.
 */
export const DAILY_SEND_ENABLED = false;
