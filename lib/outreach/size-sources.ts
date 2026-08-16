import type { DiscoveredLead } from "./leads";

export const OUTREACH_100_URL = "https://outreach100.com/largest-churches-in-america";
export const HARTFORD_MEGACHURCH_URL = "https://hirr.hartfordinternational.edu/research/megachurch-database/";

function hostname(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function attendanceSourceLabel(raw: string | null | undefined): string | null {
  const host = hostname(raw);
  if (!host) return null;
  if (host === "outreach100.com" || host.endsWith(".outreach100.com")) return "Outreach 100";
  return "Church-published source";
}

/**
 * Hartford permits links to its database but explicitly prohibits copying or
 * private/commercial reuse of its list. Keep it available as a human reference,
 * but never persist attendance extracted directly from it.
 */
export function applyAttendanceSourcePolicy(lead: DiscoveredLead): DiscoveredLead {
  const attendance = lead.estimated_attendance;
  const source = lead.attendance_source_url?.trim() || null;
  const host = hostname(source);
  const prohibitedHartfordSource = host === "hartfordinternational.edu"
    || Boolean(host?.endsWith(".hartfordinternational.edu"))
    || host === "hartsem.edu"
    || Boolean(host?.endsWith(".hartsem.edu"));
  if (!Number.isInteger(attendance) || Number(attendance) <= 0 || !host || prohibitedHartfordSource) {
    return { ...lead, estimated_attendance: null, attendance_source_url: null };
  }
  return { ...lead, estimated_attendance: Number(attendance), attendance_source_url: source };
}

export function sizeSourcePrompt(): string {
  return `CHURCH-SIZE SOURCES:
- Check the current Outreach 100 Largest Churches list first: ${OUTREACH_100_URL}. Use the individual church profile URL as attendance_source_url when it states an attendance figure. Outreach 100 is size evidence only; never use it for candidate identity, youth-ministry proof, or contact information.
- Hartford Institute's Megachurch Database may be linked for human reference at ${HARTFORD_MEGACHURCH_URL}, but its published use restrictions prohibit copying its list into this system. Do not extract or return attendance directly from any Hartford domain. Outreach 100 may cite Hartford as its underlying research; in that case cite the Outreach 100 church profile, not Hartford.
- If Outreach 100 has no matching current profile, a congregation-owned page, annual report, or denomination-published report may establish attendance. Never infer or guess attendance.`;
}
