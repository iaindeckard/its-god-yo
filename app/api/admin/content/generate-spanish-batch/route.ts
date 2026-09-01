import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { invokeReviewFn } from "@/lib/reviewFunctions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Bulk Spanish generation. There's no ES equivalent of generate-monthly-batch
 * (generate-daily-verse only does one (date, track) at a time, and only once
 * the English slot for that date/track already exists) — this route loops the
 * single-slot ES generator over an explicit date list, sequentially, so a
 * caller can build a Spanish backlog in one request instead of one click per
 * date. Chunk the `dates` array client-side (~10 dates/request) to stay well
 * inside the 300s function budget — each date costs 2 generation calls + 2
 * fidelity-judge calls to two different AI providers.
 */
export async function POST(req: Request) {
  try {
    await requirePermission("content.generate");
    const body = await req.json().catch(() => ({}));
    const dates: unknown = body.dates;
    const track: string = typeof body.track === "string" && body.track.trim() ? body.track.trim() : "general";
    if (!Array.isArray(dates) || dates.length === 0 || !dates.every((d) => typeof d === "string")) {
      return NextResponse.json({ error: "dates must be a non-empty array of YYYY-MM-DD strings" }, { status: 400 });
    }

    const results: Array<{ date: string; ok: boolean; slot_status_es?: string; error?: string }> = [];
    for (const date of dates as string[]) {
      try {
        const r = (await invokeReviewFn("generate-daily-verse", {
          target_date: date,
          theme_track: track,
          language: "es",
        })) as { slot_status_es?: string };
        results.push({ date, ok: true, slot_status_es: r.slot_status_es });
      } catch (e) {
        results.push({ date, ok: false, error: (e as Error).message });
      }
    }

    return NextResponse.json({
      track,
      results,
      summary: {
        total: results.length,
        generated: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
