/**
 * DM from Him inspirational openers (locked pool, 130 lines, approved 2026-08-05).
 *
 * A short personalized line that leads the daily DM-from-Him message (the opener
 * REPLACES the standard "a little note from Me today" greeting when it fits the
 * 2-segment budget; see lib/dmAddon.composeDailyMessage + lib/dailySend). Selection
 * is per-subscriber shuffle-then-cycle (lib/dmOpenerRotation), NOT random, so no
 * line repeats until all 130 are used.
 *
 * RULES (enforced by the dash lint, which now scans this file):
 *  - Flat, undifferentiated list. Do NOT bucket by theme — every line must have an
 *    equal chance, so ordering/grouping here is meaningless by design.
 *  - Every line contains the [name] token (substituted with the recipient's first
 *    name; falls back to "friend" when absent).
 *  - GSM-7 only, no em/en dashes, no emoji, no curly quotes (keeps sends cheap +
 *    avoids "written by AI" tells).
 *
 * Annual review: see OPENER_POOL_LIVE_DATE below + /api/cron/opener-pool-review.
 */

// Date this pool went live. Drives the one-year "time to review the openers"
// ops-alert. Update ONLY when the pool is intentionally refreshed.
export const OPENER_POOL_LIVE_DATE = "2026-08-05";

export const DM_OPENERS: readonly string[] = [
  "[name], before anything else today, just know you're loved exactly as you are.",
  "[name], you don't have to earn this. You're already enough.",
  "Whatever today brings, [name], you belong to Someone who never lets go.",
  "[name], you were made on purpose, for a purpose.",
  "No performance required, [name]. You're already seen and already loved.",
  "[name], you carry something in you that nobody else does. That's not an accident.",
  "You are known, [name]. Fully. And still loved.",
  "[name], your worth was never up for debate.",
  "Today's a good day to remember you're somebody's favorite, [name]. Yours.",
  "[name], you don't need to be fixed to be loved. You already are.",
  "[name], you're carrying more than people know, and you're still standing. That matters.",
  "Hard days don't make you weak, [name]. They make you real.",
  "[name], you have more strength in you than you give yourself credit for.",
  "Whatever you're facing today, [name], you don't have to face it alone.",
  "[name], showing up today counts, even if it doesn't feel like much.",
  "You've survived every hard day so far, [name]. That's not nothing.",
  "[name], courage isn't about not being scared. It's showing up anyway.",
  "Today might be tough, [name], but you're tougher.",
  "[name], you don't have to have it all figured out to keep going.",
  "One step at a time, [name]. That's all today asks of you.",
  "[name], you're not carrying today by yourself.",
  "Even on the quiet days, [name], you're not forgotten.",
  "[name], somebody's rooting for you today. Start with Me.",
  "Wherever today takes you, [name], you're not walking into it alone.",
  "[name], I see the stuff nobody else notices. And I'm proud of you.",
  "You don't have to perform for attention today, [name]. You already have Mine.",
  "[name], even your bad days don't scare Me off.",
  "Whatever's on your mind today, [name], you can bring it here.",
  "[name], you matter more than you realize, on your best day and your worst.",
  "Today, [name], just know you're thought of.",
  "[name], your story isn't finished, and neither is what you're capable of.",
  "Today's a new page, [name]. Write it well.",
  "[name], you were built for more than just getting through the day.",
  "Small good choices today add up, [name]. Keep going.",
  "[name], you have a purpose bigger than how today feels.",
  "Whatever mistakes happened yesterday, [name], today's a clean start.",
  "[name], the world needs exactly who you are, not a copy of someone else.",
  "Your future self is counting on the choices you make today, [name].",
  "[name], hope isn't naive. It's a decision. Make it today.",
  "Today's hard parts don't get the final word, [name]. I do.",
  "[name], real talk: you're doing better than you think.",
  "Hey [name], quick reminder before your day gets loud: you're loved.",
  "[name], no cap, you matter more than you know.",
  "Before your phone blows up today, [name], here's one thing that's true: you're valued.",
  "[name], out of everyone I could text today, I'm glad it's you.",
  "[name], you don't have to have your life together to be worth loving.",
  "Plot twist, [name]: you're already exactly who you need to be today.",
  "[name], breathe. You've got this, and you've got Me.",
  "Hey [name], just checking in before the chaos starts. You're good.",
  "[name], today's forecast: loved, no matter what else happens.",
  "[name], you're not too much and you're not too little. You're just right.",
  "Today, [name], remember you're not defined by your worst moment.",
  "[name], I made you with intention. Nothing about you is a mistake.",
  "You don't need anyone's approval today, [name]. You already have Mine.",
  "[name], your value doesn't change based on how today goes.",
  "Whatever labels people put on you, [name], I see you differently.",
  "[name], you're allowed to just be yourself today. That's enough.",
  "Today's a good day to remember whose you are, [name].",
  "[name], comparison isn't your job. Being you is.",
  "You're not behind, [name]. You're exactly where you are for a reason.",
  "[name], it's okay to not be okay today. I'm still here.",
  "Today doesn't have to be perfect, [name]. Just honest.",
  "[name], asking for help isn't weakness. It's wisdom.",
  "You've made it through 100% of your hard days so far, [name].",
  "[name], you're allowed to rest. You're not a machine.",
  "Whatever you're nervous about today, [name], you're more ready than you think.",
  "[name], setbacks aren't the end of your story.",
  "Today, [name], give yourself the grace you'd give a friend.",
  "[name], you don't have to carry everything alone today.",
  "It's okay to take today slow, [name]. There's no prize for rushing.",
  "[name], even on your quietest days, you're not invisible to Me.",
  "Wherever today leads, [name], I already knew it was coming.",
  "[name], you can be honest with Me about how today's going.",
  "No matter who forgets to check on you, [name], I never do.",
  "[name], you're allowed to feel whatever you're feeling today.",
  "Today, [name], just know Someone's paying attention to you.",
  "[name], you don't have to explain yourself to be understood here.",
  "Even when it's quiet, [name], I haven't gone anywhere.",
  "[name], your bad mood today doesn't push Me away.",
  "Whatever today looks like, [name], you're covered.",
  "[name], today's a chance to become who you're becoming.",
  "Your effort today matters more than you'll know for a while, [name].",
  "[name], you don't need a perfect week, just a decent today.",
  "Today's struggles are shaping something in you, [name]. Trust the process.",
  "[name], you have more time and more chances than you think.",
  "Whatever today's outcome is, [name], it's not your whole story.",
  "[name], growth is quiet most days. Keep going anyway.",
  "Today's a good day to try again, [name].",
  "[name], you're capable of more than yesterday's version of you.",
  "Your today matters, [name], even the boring parts.",
  "[name], hope your day starts easier than it sounds.",
  "Just a reminder, [name]: you're worth checking in on.",
  "[name], I hope something good happens to you today.",
  "Sending this before your day gets busy, [name]. You matter.",
  "[name], I'm glad you're here today. Genuinely.",
  "Hey [name], here's your one good thing today: you're loved.",
  "[name], I hope today treats you kindly.",
  "Just wanted to remind you, [name], before anything else happens today.",
  "[name], you're someone worth rooting for.",
  "Today, [name], I hope you feel a little lighter.",
  "[name], you don't have to have it all together to be doing fine.",
  "Today's a good day to be gentle with yourself, [name].",
  "[name], you're more resilient than today's stress suggests.",
  "Whatever's weighing on you, [name], it's not too heavy for Me.",
  "[name], your patience today isn't wasted, even when it feels like it.",
  "Today's hard conversation doesn't define you, [name].",
  "[name], you're allowed to change your mind and start over.",
  "It's not too late to have a good day, [name].",
  "[name], you're doing better at this than you think.",
  "Today, [name], remember your effort counts even when nobody notices.",
  "[name], real talk, you're handling more than people realize.",
  "Ngl, [name], you're stronger than you give yourself credit for.",
  "[name], not gonna lie, today's gonna be fine. You've got this.",
  "Low key, [name], you're one of the good ones.",
  "[name], for real, someone out there is glad you exist. Me, for starters.",
  "[name], you're not a burden today, no matter how you feel.",
  "Whatever today throws at you, [name], you're built for it.",
  "[name], you're allowed to have an average day. That's okay too.",
  "Today, [name], remember someone's proud of who you're becoming.",
  "[name], you're not alone in whatever you're carrying today.",
  "Here's your reminder, [name]: today is a gift, even the hard parts.",
  "[name], I hope today gives you a reason to smile.",
  "Whatever mood you woke up in, [name], you're still worth showing up for.",
  "[name], you don't need to prove anything to Me today.",
  "Today's a good day to remember you're not replaceable, [name].",
  "[name], I hope today is kinder than yesterday.",
  "Wherever you are today, [name], you're not forgotten.",
  "[name], you're allowed to just breathe today.",
  "Today, [name], you're exactly where you need to be.",
  "[name], no matter what, today ends with you still being loved.",
] as const;

/** Substitute the [name] token. Falls back to "friend" when no first name. */
export function renderOpener(opener: string, firstName?: string | null): string {
  const who = firstName && firstName.trim() ? firstName.trim() : "friend";
  const s = opener.replace(/\[name\]/g, who);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
