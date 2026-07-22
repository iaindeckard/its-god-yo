import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { getTrackSummaries, getTagsForTrack } from "@/lib/themeTags";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requirePermission("content.theme_tags.view");
    const url = new URL(req.url);
    const track = url.searchParams.get("track");
    const status = url.searchParams.get("status") || "proposed";
    const summaries = await getTrackSummaries();
    const tags = track ? await getTagsForTrack(track, status) : [];
    return NextResponse.json({ summaries, track, status, tags });
  } catch (e) {
    return apiError(e);
  }
}
