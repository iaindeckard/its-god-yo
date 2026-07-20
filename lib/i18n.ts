/**
 * EN/ES copy for the whole site + signup flow. Language is chosen first in the
 * signup wizard and drives every string (and the values POSTed to
 * submit-consent, whose stored consent/SMS copy is generated server-side in the
 * SAME language).
 *
 * NOTE (honorifics / relationships): these localized option lists are what the
 * "DM from Him" SMS lead-in interpolates verbatim — e.g. ES relationship "Abuela"
 * + gifter "Linda" renders "Tu Abuela Linda ...". They are a reasonable locked-
 * spec mirror; adjust the lists here if the consent spec's canonical lists differ.
 */
export type Lang = "en" | "es";

export const LANGS: Lang[] = ["en", "es"];

export const HONORIFICS: Record<Lang, string[]> = {
  en: ["Fr.", "Pastor", "Rev.", "Deacon", "Sister", "Brother", "Rabbi", "Dr."],
  es: ["P.", "Pastor", "Rev.", "Diácono", "Hna.", "Hno.", "Rabino", "Dr."],
};

export const RELATIONSHIPS: Record<Lang, string[]> = {
  en: ["Grandmother", "Grandfather", "Mom", "Dad", "Aunt", "Uncle", "Sister", "Brother", "Cousin", "Godmother", "Godfather", "Youth Leader", "Teacher", "Friend"],
  es: ["Abuela", "Abuelo", "Mamá", "Papá", "Tía", "Tío", "Hermana", "Hermano", "Prima/o", "Madrina", "Padrino", "Líder Juvenil", "Maestra/o", "Amiga/o"],
};

export const t = {
  en: {
    // nav / hero
    signIn: "Sign in",
    getStarted: "Get started",
    tagline: "God's Word in your words.",
    heroTitle: "A daily verse, texted the way you'd actually text.",
    heroBody:
      "Scripture, rendered as short casual messages that sound like a friend — not a lecture. One a day, in English or Spanish.",
    seePricing: "See pricing",
    heroNote: "No charge until your teen texts back YES. Cancel anytime.",
    sampleMeta: "Today · Psalm 46:10",
    sampleBubble: "chill for a sec and just KNOW i'm God 🙌 i got this — the whole world, all of it",
    // how it works
    howEyebrow: "How it works",
    howTitle: "Good News that fits in a text bubble",
    how1Title: "Pick a plan",
    how1Body: "For yourself, your family, a gift, or a whole youth group.",
    how2Title: "We text to confirm",
    how2Body: "Nobody gets signed up without replying YES themselves. Consent first, always.",
    how3Title: "A verse a day",
    how3Body: "Every morning, one verse in language that actually lands.",
    // pricing
    pricingEyebrow: "Pricing",
    pricingTitle: "Simple plans, honest prices",
    pricingSub: "Billing only starts after the recipient confirms by text. Add “DM from Him” to any plan for +$1.99/mo.",
    perMonth: "/mo",
    perYear: "/yr",
    perTeenYear: "/teen · yr",
    mostPopular: "Most popular",
    planIndividualName: "Individual",
    planIndividualDesc: "One person, one daily verse.",
    planFamilyName: "Family",
    planFamilyDesc: "Up to 4 teens under one plan.",
    planGiftName: "Gift",
    planGiftDesc: "Give a year of daily Good News.",
    planGroupName: "Group / Ministry",
    planGroupDesc: "Youth groups, schools, and ministries. Per-teen pricing.",
    contactUs: "Contact us",
    from: "from",
    choosePlan: "Choose plan",
    dmAddonName: "DM from Him add-on",
    dmAddonDesc: "A personal invite text from whoever gifted it — +$1.99/mo.",
    // footer
    footerTagline: "God's Word in your words.",
    footerRights: "All rights reserved.",

    // ---- wizard ----
    wLang: "First — which language?",
    wLangSub: "This sets the language of the daily verses and every message we send.",
    english: "English",
    spanish: "Español",
    continue: "Continue",
    back: "Back",
    wPlanTitle: "Choose your plan",
    teenCount: "How many teens?",
    teenCountHint: "We'll pick the right per-teen rate automatically.",
    groupContactTitle: "Let's talk",
    groupContactBody:
      "Groups of 301+ get custom pricing. Leave your email and we'll reach out within one business day.",
    yourEmail: "Your email",
    requestQuote: "Request a quote",
    perYearTotal: "billed yearly",
    estTotal: "Estimated total",

    wRecipientTitle: "Who's this for?",
    wRecipientSub: "Just a first name for now — we'll ask for the phone number at the end.",
    recipientFirstName: "Recipient's first name",
    purchaserEmailLabel: "Your email (for receipts & updates)",

    wPlusOneTitle: "Add a “DM from Him”?",
    wPlusOneSub:
      "Gift a second person a daily verse too — with a personal invite text from you. +$1.99/mo.",
    addPlusOne: "Yes, add a +1",
    noThanks: "No thanks",
    fromWho: "Who's it from?",
    honorificLabel: "Title (optional)",
    honorificNone: "— none —",
    relationshipLabel: "Your relationship to them",
    relationshipPick: "— choose —",
    gifterFirstName: "Your first name",
    gifterLastName: "Your last name (optional)",
    plusOneRecipientName: "Their first name",
    plusOneRecipientPhone: "Their mobile number",

    wReferralTitle: "Have a referral code?",
    wReferralSub: "Enter one to take 10% off. Totally optional.",
    referralLabel: "Referral code",
    referralApplied: "10% off applied — nice!",
    referralSkip: "Skip",
    apply: "Apply",

    promoFieldLabel: "Promo code",
    promoFieldPlaceholder: "e.g. WSULAUNCH25",
    promoFieldHint: "A discount from us — separate from a referral code.",
    promoApplied: "Promo applied",
    promoInvalid: "That promo code isn't valid or has expired.",

    wPayTitle: "Save a payment method",
    wPaySub:
      "We save your card now but don't charge it. Billing only begins after the recipient confirms by text — with a 7-day free trial from that moment.",
    saveCard: "Save card",
    cardProcessing: "Saving…",

    wPhoneTitle: "Last step — the phone number",
    wPhoneSub: "We'll text them to confirm. No one is ever signed up without replying YES.",
    recipientPhone: "Recipient's mobile number",
    attestationHeading: "Please confirm",
    disclosureHeading: "What happens next",
    iConfirm: "I confirm the above",
    submitSignup: "Text them to confirm",
    submitting: "Sending…",

    doneTitle: "You're all set!",
    startOver: "Start another",
    noChargeYet: "No charge has been made. Billing begins only after they reply YES.",
    reviewTitle: "Review",
    plan: "Plan",
    addon: "DM from Him add-on",
    referral: "Referral",
    yes: "Yes",
    no: "No",
  },

  es: {
    signIn: "Iniciar sesión",
    getStarted: "Empezar",
    tagline: "La Palabra de Dios en tus palabras.",
    heroTitle: "Un versículo diario, escrito como tú de verdad escribes.",
    heroBody:
      "La Escritura, en mensajes cortos y casuales que suenan como un amigo — no como un sermón. Uno al día, en inglés o español.",
    seePricing: "Ver precios",
    heroNote: "No se cobra hasta que tu chavo responda SÍ. Cancela cuando quieras.",
    sampleMeta: "Hoy · Salmos 46:10",
    sampleBubble: "para tantito y nomás reconoce que yo soy Dios 🙌 yo me encargo — del mundo entero, de todo",
    howEyebrow: "Cómo funciona",
    howTitle: "Buenas Nuevas que caben en un mensaje",
    how1Title: "Elige un plan",
    how1Body: "Para ti, tu familia, un regalo, o todo un grupo juvenil.",
    how2Title: "Enviamos un texto para confirmar",
    how2Body: "Nadie se inscribe sin responder SÍ. Primero el consentimiento, siempre.",
    how3Title: "Un versículo al día",
    how3Body: "Cada mañana, un versículo en palabras que de verdad llegan.",
    pricingEyebrow: "Precios",
    pricingTitle: "Planes simples, precios honestos",
    pricingSub: "El cobro empieza solo después de que la persona confirme por texto. Agrega “DM de Él” a cualquier plan por +$1.99/mes.",
    perMonth: "/mes",
    perYear: "/año",
    perTeenYear: "/chavo · año",
    mostPopular: "Más popular",
    planIndividualName: "Individual",
    planIndividualDesc: "Una persona, un versículo diario.",
    planFamilyName: "Familia",
    planFamilyDesc: "Hasta 4 chavos en un plan.",
    planGiftName: "Regalo",
    planGiftDesc: "Regala un año de Buenas Nuevas diarias.",
    planGroupName: "Grupo / Ministerio",
    planGroupDesc: "Grupos juveniles, escuelas y ministerios. Precio por chavo.",
    contactUs: "Contáctanos",
    from: "desde",
    choosePlan: "Elegir plan",
    dmAddonName: "Complemento “DM de Él”",
    dmAddonDesc: "Un texto de invitación personal de quien lo regaló — +$1.99/mes.",
    footerTagline: "La Palabra de Dios en tus palabras.",
    footerRights: "Todos los derechos reservados.",

    wLang: "Primero — ¿en qué idioma?",
    wLangSub: "Esto define el idioma de los versículos diarios y de cada mensaje que enviamos.",
    english: "English",
    spanish: "Español",
    continue: "Continuar",
    back: "Atrás",
    wPlanTitle: "Elige tu plan",
    teenCount: "¿Cuántos chavos?",
    teenCountHint: "Elegimos la tarifa por chavo automáticamente.",
    groupContactTitle: "Hablemos",
    groupContactBody:
      "Los grupos de 301+ tienen precio personalizado. Déjanos tu correo y te contactamos en un día hábil.",
    yourEmail: "Tu correo",
    requestQuote: "Solicitar cotización",
    perYearTotal: "cobro anual",
    estTotal: "Total estimado",

    wRecipientTitle: "¿Para quién es?",
    wRecipientSub: "Por ahora solo el nombre — el número lo pedimos al final.",
    recipientFirstName: "Nombre de la persona",
    purchaserEmailLabel: "Tu correo (para recibos y avisos)",

    wPlusOneTitle: "¿Agregar un “DM de Él”?",
    wPlusOneSub:
      "Regálale un versículo diario a una segunda persona — con un texto de invitación personal tuyo. +$1.99/mes.",
    addPlusOne: "Sí, agregar un +1",
    noThanks: "No, gracias",
    fromWho: "¿De parte de quién?",
    honorificLabel: "Título (opcional)",
    honorificNone: "— ninguno —",
    relationshipLabel: "Tu parentesco con esa persona",
    relationshipPick: "— elige —",
    gifterFirstName: "Tu nombre",
    gifterLastName: "Tu apellido (opcional)",
    plusOneRecipientName: "Su nombre",
    plusOneRecipientPhone: "Su número de celular",

    wReferralTitle: "¿Tienes un código de referido?",
    wReferralSub: "Ingresa uno para 10% de descuento. Totalmente opcional.",
    referralLabel: "Código de referido",
    referralApplied: "¡10% de descuento aplicado!",
    referralSkip: "Omitir",
    apply: "Aplicar",

    promoFieldLabel: "Código promocional",
    promoFieldPlaceholder: "ej. WSULAUNCH25",
    promoFieldHint: "Un descuento de nuestra parte — distinto de un código de referido.",
    promoApplied: "Promo aplicado",
    promoInvalid: "Ese código promocional no es válido o expiró.",

    wPayTitle: "Guarda un método de pago",
    wPaySub:
      "Guardamos tu tarjeta ahora pero no la cobramos. El cobro empieza solo después de que la persona confirme por texto — con 7 días de prueba gratis desde ese momento.",
    saveCard: "Guardar tarjeta",
    cardProcessing: "Guardando…",

    wPhoneTitle: "Último paso — el número",
    wPhoneSub: "Le enviaremos un texto para confirmar. Nadie se inscribe sin responder SÍ.",
    recipientPhone: "Número de celular",
    attestationHeading: "Por favor confirma",
    disclosureHeading: "Qué pasa después",
    iConfirm: "Confirmo lo anterior",
    submitSignup: "Enviarle el texto de confirmación",
    submitting: "Enviando…",

    doneTitle: "¡Todo listo!",
    startOver: "Empezar otro",
    noChargeYet: "No se ha hecho ningún cobro. El cobro empieza solo cuando responda SÍ.",
    reviewTitle: "Resumen",
    plan: "Plan",
    addon: "Complemento DM de Él",
    referral: "Referido",
    yes: "Sí",
    no: "No",
  },
} as const;

/** Attestation / disclosure — MUST match submit-consent's server-side copy verbatim
 *  (same CONSENT_VERSION 2026-07-20) so what the user sees == what we store. */
export const CONSENT_VERSION = "2026-07-20";
export const ATTESTATION: Record<Lang, (name: string) => string> = {
  en: (n) => `I confirm this is ${n}'s real phone number, that I have their permission to share it, and that I believe they'd want to receive this.`,
  es: (n) => `Confirmo que este es el número de teléfono real de ${n}, que tengo su permiso para compartirlo, y que creo que le gustaría recibir esto.`,
};
export const DISCLOSURE: Record<Lang, (name: string) => string> = {
  en: (n) => `${n} will get a text asking them to confirm — we can't sign anyone up without their own OK. If they don't reply within 48 hours, we'll let you know so you can resend the invite if you'd like. You can resend up to 3 times over 30 days; after that, you'd need to start over. We'll never resend automatically or keep texting someone who hasn't responded.`,
  es: (n) => `${n} recibirá un mensaje de texto pidiéndole que confirme — no podemos inscribir a nadie sin su propio consentimiento. Si no responde en 48 horas, te avisaremos para que puedas reenviar la invitación si lo deseas. Puedes reenviarla hasta 3 veces en un período de 30 días; después de eso, tendrías que empezar de nuevo. Nunca reenviaremos automáticamente ni seguiremos enviando mensajes a alguien que no ha respondido.`,
};
