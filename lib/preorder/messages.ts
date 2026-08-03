import "server-only";

/**
 * Locked copy for the four preorder / activation notifications. Each returns an
 * SMS body plus a matching transactional email ({subject,text,html}). STOP/HELP
 * keyword language stays in English in both locales (carrier requirement).
 */

export type Lang = "en" | "es";

export interface PreorderEmail {
  subject: string;
  text: string;
  html: string;
}
export interface PreorderMessage {
  sms: string;
  email: PreorderEmail;
}

const COMPANY_ADDRESS = "Deckard Enterprise International, LLC · 2221 N Amarado St, Wichita, KS 67205";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
function wrapHtml(bodyHtml: string): string {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a;max-width:600px;margin:0 auto;">
${bodyHtml}
  <hr style="border:none;border-top:1px solid #e2e2e2;margin:22px 0;"/>
  <p style="font-size:12px;color:#777;">It's God, Yo!™ · ${esc(COMPANY_ADDRESS)}</p>
</div>`;
}
function button(url: string, label: string): string {
  return `<p style="margin:20px 0;"><a href="${esc(url)}" style="background:#378ADD;color:#fff;text-decoration:none;padding:11px 20px;border-radius:10px;font-weight:600;display:inline-block;">${esc(label)}</a></p>`;
}
const who = (name?: string | null) => (name && name.trim() ? name.trim() : "there");
const quien = (name?: string | null) => (name && name.trim() ? name.trim() : "");

/** Launch trigger: "we're live — reply YES to activate." */
export function launchConfirmation(name: string | null, lang: Lang): PreorderMessage {
  if (lang === "es") {
    const n = quien(name);
    return {
      sms: `¡Hola${n ? " " + n : ""}! It's God, Yo! ya está por lanzar. Responde SÍ para activar tus Buenas Nuevas diarias. Aplican tarifas de mensajes y datos. Responde STOP para cancelar, HELP para ayuda.`,
      email: {
        subject: "It's God, Yo! está por lanzar — confirma para activar",
        text: `¡Hola${n ? " " + n : ""}! Ya estamos por lanzar. Responde SÍ al mensaje de texto que te enviamos para activar tus Buenas Nuevas diarias. No haremos ningún cargo hasta que confirmes.`,
        html: wrapHtml(`<p>¡Hola${n ? " " + esc(n) : ""}!</p><p>Ya estamos por lanzar. Responde <strong>SÍ</strong> al mensaje de texto que te enviamos para activar tus Buenas Nuevas diarias.</p><p>No haremos ningún cargo hasta que confirmes.</p>`),
      },
    };
  }
  const n = who(name);
  return {
    sms: `Hi ${n}! It's God, Yo! is about to launch. Reply YES to activate your daily Good News. Msg & data rates may apply. Reply STOP to cancel, HELP for help.`,
    email: {
      subject: "It's God, Yo! is launching — confirm to activate",
      text: `Hi ${n}! We're about to launch. Reply YES to the text we just sent to activate your daily Good News. We won't charge you until you confirm.`,
      html: wrapHtml(`<p>Hi ${esc(n)}!</p><p>We're about to launch. Reply <strong>YES</strong> to the text we just sent to activate your daily Good News.</p><p>We won't charge you until you confirm.</p>`),
    },
  };
}

/** ~3-day nudge for an unconfirmed activation. */
export function confirmationReminder(name: string | null, lang: Lang): PreorderMessage {
  if (lang === "es") {
    const n = quien(name);
    return {
      sms: `Recordatorio de It's God, Yo!: responde SÍ para activar tus Buenas Nuevas diarias. Si no respondes, liberaremos tu lugar pronto. Responde STOP para cancelar.`,
      email: {
        subject: "Recordatorio: confirma para activar It's God, Yo!",
        text: `¡Hola${n ? " " + n : ""}! Solo un recordatorio: responde SÍ para activar tus Buenas Nuevas diarias. Si no recibimos respuesta, liberaremos tu lugar pronto.`,
        html: wrapHtml(`<p>¡Hola${n ? " " + esc(n) : ""}!</p><p>Solo un recordatorio: responde <strong>SÍ</strong> al mensaje de texto para activar tus Buenas Nuevas diarias.</p><p>Si no recibimos respuesta, liberaremos tu lugar pronto.</p>`),
      },
    };
  }
  const n = who(name);
  return {
    sms: `Reminder from It's God, Yo!: reply YES to activate your daily Good News. If we don't hear back, we'll release your spot soon. Reply STOP to cancel.`,
    email: {
      subject: "Reminder: confirm to activate It's God, Yo!",
      text: `Hi ${n}! Just a reminder — reply YES to activate your daily Good News. If we don't hear back, we'll release your spot soon.`,
      html: wrapHtml(`<p>Hi ${esc(n)}!</p><p>Just a reminder — reply <strong>YES</strong> to the text to activate your daily Good News.</p><p>If we don't hear back, we'll release your spot soon.</p>`),
    },
  };
}

/** Immediate notice when the launch-day charge is declined. */
export function paymentDeclined(name: string | null, lang: Lang, url: string): PreorderMessage {
  if (lang === "es") {
    const n = quien(name);
    return {
      sms: `It's God, Yo!: no pudimos procesar tu tarjeta. Actualízala aquí para activar: ${url} Responde STOP para cancelar.`,
      email: {
        subject: "No pudimos procesar tu tarjeta — It's God, Yo!",
        text: `¡Hola${n ? " " + n : ""}! Tu confirmación llegó, pero no pudimos procesar tu tarjeta. Actualiza tu método de pago aquí para activar: ${url}`,
        html: wrapHtml(`<p>¡Hola${n ? " " + esc(n) : ""}!</p><p>Recibimos tu confirmación, pero no pudimos procesar tu tarjeta.</p>${button(url, "Actualizar tarjeta")}<p style="font-size:13px;color:#777;">O copia este enlace: ${esc(url)}</p>`),
      },
    };
  }
  const n = who(name);
  return {
    sms: `It's God, Yo!: we couldn't process your card. Update it here to activate: ${url} Reply STOP to cancel.`,
    email: {
      subject: "We couldn't process your card — It's God, Yo!",
      text: `Hi ${n}! Your confirmation came through, but we couldn't process your card. Update your payment method here to activate: ${url}`,
      html: wrapHtml(`<p>Hi ${esc(n)}!</p><p>Your confirmation came through, but we couldn't process your card.</p>${button(url, "Update card")}<p style="font-size:13px;color:#777;">Or copy this link: ${esc(url)}</p>`),
    },
  };
}

/** Activation succeeded (retry-page charge went through). SMS-only helper — the
 *  recipient gets the "all set" text with their welcome link. */
export function activatedSms(name: string | null, lang: Lang, welcomeUrl: string | null): string {
  const link = welcomeUrl ? (lang === "es" ? ` Elige tu hora diaria: ${welcomeUrl}` : ` Pick your daily time: ${welcomeUrl}`) : "";
  if (lang === "es") {
    return `¡Todo listo${name ? ", " + name : ""}! Empezarás a recibir Buenas Nuevas diarias de It's God, Yo! 🙏${link}`;
  }
  return `You're all set${name ? ", " + name : ""}! You'll start getting daily Good News from It's God, Yo! 🙏${link}`;
}

/** ~3-day nudge for an unresolved declined payment. */
export function paymentReminder(name: string | null, lang: Lang, url: string): PreorderMessage {
  if (lang === "es") {
    const n = quien(name);
    return {
      sms: `Recordatorio de It's God, Yo!: tu tarjeta aún necesita actualizarse para activar. Hazlo aquí: ${url} Responde STOP para cancelar.`,
      email: {
        subject: "Recordatorio: actualiza tu tarjeta — It's God, Yo!",
        text: `¡Hola${n ? " " + n : ""}! Tu tarjeta aún necesita actualizarse para activar tus Buenas Nuevas diarias. Actualízala aquí: ${url}`,
        html: wrapHtml(`<p>¡Hola${n ? " " + esc(n) : ""}!</p><p>Tu tarjeta aún necesita actualizarse para activar tus Buenas Nuevas diarias.</p>${button(url, "Actualizar tarjeta")}<p style="font-size:13px;color:#777;">O copia este enlace: ${esc(url)}</p>`),
      },
    };
  }
  const n = who(name);
  return {
    sms: `Reminder from It's God, Yo!: your card still needs updating to activate. Do it here: ${url} Reply STOP to cancel.`,
    email: {
      subject: "Reminder: update your card — It's God, Yo!",
      text: `Hi ${n}! Your card still needs updating to activate your daily Good News. Update it here: ${url}`,
      html: wrapHtml(`<p>Hi ${esc(n)}!</p><p>Your card still needs updating to activate your daily Good News.</p>${button(url, "Update card")}<p style="font-size:13px;color:#777;">Or copy this link: ${esc(url)}</p>`),
    },
  };
}
