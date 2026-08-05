import "server-only";
import { sendGate, sendAllowlist } from "./config";
import { fetchActiveLeads, recordSend, ageOut, AGE_OUT_LIMIT } from "./leads";
import { buildEmail, sendViaResend } from "./email";

// Promo-code minting moved to the second-touch (email 2) path. The first outreach
// email is code-free (Iain, 2026-08-05); the code-minting helpers return here when
// email 2 is built.

export interface SendItem {
  lead_id: string;
  org_name: string;
  to: string;
  outcome: "would_send" | "sent" | "aged_out" | "skipped_allowlist" | "error";
  promo_code: string;
  subject: string;
  send_count_after: number;
  error?: string;
}

export interface SendReport {
  mode: "live" | "dry_run";
  gate_reasons: string[];
  scanned: number;
  sent: number;
  would_send: number;
  aged_out: number;
  skipped: number;
  errors: number;
  items: SendItem[];
  generated_at: string;
}

/**
 * Run the monthly send. DRY-RUN unless the send gate is fully open (copy +
 * legal + master switch, see config.sendGate). In dry-run nothing is minted and
 * nothing is sent — it renders exactly who would receive what. Age-out (§7.3) is
 * applied in BOTH modes because it's a lifecycle transition, not a send.
 */
export async function runSend(forceDry = false): Promise<SendReport> {
  const gate = sendGate();
  const live = gate.live && !forceDry;
  const allowlist = sendAllowlist();
  const leads = await fetchActiveLeads();

  const report: SendReport = {
    mode: live ? "live" : "dry_run",
    gate_reasons: gate.reasons,
    scanned: leads.length,
    sent: 0, would_send: 0, aged_out: 0, skipped: 0, errors: 0,
    items: [],
    generated_at: new Date().toISOString(),
  };

  for (const lead of leads) {
    // §7.3 — already sent the max without converting: age out, don't send again.
    if (lead.send_count >= AGE_OUT_LIMIT) {
      if (live) await ageOut(lead.id);
      report.aged_out++;
      report.items.push({
        lead_id: lead.id, org_name: lead.org_name, to: lead.contact_email,
        outcome: "aged_out", promo_code: lead.promo_code ?? "", subject: "",
        send_count_after: lead.send_count,
      });
      continue;
    }

    // First controlled live batch may be restricted to an allowlist.
    if (live && allowlist && !allowlist.has(lead.contact_email.toLowerCase())) {
      report.skipped++;
      report.items.push({
        lead_id: lead.id, org_name: lead.org_name, to: lead.contact_email,
        outcome: "skipped_allowlist", promo_code: "", subject: "", send_count_after: lead.send_count,
      });
      continue;
    }

    if (!live) {
      // Dry run: render, send nothing. Email 1 is code-free.
      const preview = buildEmail(lead);
      report.would_send++;
      report.items.push({
        lead_id: lead.id, org_name: lead.org_name, to: lead.contact_email,
        outcome: "would_send", promo_code: "",
        subject: preview.subject, send_count_after: lead.send_count + 1,
      });
      continue;
    }

    // Live send (email 1 — code-free; the 10%-off code comes with email 2).
    try {
      const email = buildEmail(lead);
      await sendViaResend(email);
      await recordSend(lead.id, lead.send_count, null);
      report.sent++;
      report.items.push({
        lead_id: lead.id, org_name: lead.org_name, to: lead.contact_email,
        outcome: "sent", promo_code: "", subject: email.subject,
        send_count_after: lead.send_count + 1,
      });
    } catch (e) {
      report.errors++;
      report.items.push({
        lead_id: lead.id, org_name: lead.org_name, to: lead.contact_email,
        outcome: "error", promo_code: "", subject: "", send_count_after: lead.send_count,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return report;
}
