import { describe, expect, it } from "vitest";
import {
  applyAttendanceSourcePolicy,
  attendanceSourceLabel,
  sizeSourcePrompt,
} from "../outreach/size-sources";

const lead = {
  org_name: "Example Church",
  contact_email: "office@example.org",
  estimated_attendance: 2500,
};

describe("outreach size sources", () => {
  it("keeps a cited Outreach 100 attendance figure", () => {
    const result = applyAttendanceSourcePolicy({
      ...lead,
      attendance_source_url: "https://outreach100.com/churches/example-church",
    });
    expect(result.estimated_attendance).toBe(2500);
    expect(attendanceSourceLabel(result.attendance_source_url)).toBe("Outreach 100");
  });

  it("keeps a cited congregation-owned attendance figure", () => {
    const result = applyAttendanceSourcePolicy({
      ...lead,
      attendance_source_url: "https://example.org/annual-report",
    });
    expect(result.estimated_attendance).toBe(2500);
    expect(attendanceSourceLabel(result.attendance_source_url)).toBe("Church-published source");
  });

  it("does not persist Hartford data under its published use restriction", () => {
    const result = applyAttendanceSourcePolicy({
      ...lead,
      attendance_source_url: "https://hirr.hartfordinternational.edu/research/megachurch-database/",
    });
    expect(result.estimated_attendance).toBeNull();
    expect(result.attendance_source_url).toBeNull();
  });

  it("rejects uncited or invalid attendance", () => {
    expect(applyAttendanceSourcePolicy(lead).estimated_attendance).toBeNull();
    expect(applyAttendanceSourcePolicy({
      ...lead,
      estimated_attendance: -1,
      attendance_source_url: "https://example.org",
    }).estimated_attendance).toBeNull();
  });

  it("keeps source roles explicit in the discovery instructions", () => {
    const prompt = sizeSourcePrompt();
    expect(prompt).toContain("size evidence only");
    expect(prompt).toContain("never use it for candidate identity");
    expect(prompt).toContain("Do not extract or return attendance directly from any Hartford domain");
  });
});
