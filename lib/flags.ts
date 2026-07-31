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
 * Master switch for the Stage 2 daily send (the /api/cron/daily-send tick).
 * While false, the cron runs in DRY mode: it still computes who is due and
 * whether approved content exists, but makes NO Twilio calls and writes NO
 * daily_send_log rows — so it can be deployed and observed harmlessly. Flip to
 * true ONLY after the full send path is verified AND Twilio toll-free
 * verification clears (locked sequencing: content+send verified → Twilio → then
 * this, then PURCHASES_ENABLED). Never enable this in isolation.
 */
export const DAILY_SEND_ENABLED = false;
