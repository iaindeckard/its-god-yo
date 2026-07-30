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
