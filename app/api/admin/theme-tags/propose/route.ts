import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { proposeForTrack } from "@/lib/themeTags";

export const dynamic = "force-dynamic";

/** Kick off the AI first pass for a track (proposes tags for human review). */
export async function POST(req: Request) {
  try {
    await requirePermission("content.theme_tags.review");
    const body = await req.json().catch(() => ({}));
    const track = typeof body.theme_track === "string" ? body.theme_track : "";
    if (!track || track === "general") {
      return NextResponse.json({ error: "a non-general theme_track is required" }, { status: 400 });
    }
    const sampleSize = body.sample_size ? Number(body.sample_size) : undefined;
    return NextResponse.json({ result: await proposeForTrack(track, sampleSize) });
  } catch (e) {
    return apiError(e);
  }
}
