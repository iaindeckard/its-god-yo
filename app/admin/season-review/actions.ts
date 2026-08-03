"use server";
import { can, getCurrentStaff } from "@/lib/rbac";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { approveItem, rejectItem, generateSeasonBatch, makePoolVerseSelector } from "@/lib/seasons/content";
import { getSeasonReviewItems } from "@/lib/seasons/reviewData";
import type { SeasonKey } from "@/lib/seasons/liturgical";

export async function loadBatchItems(batchId: string) {
  if (!(await can("content.queue.view"))) return { ok: false as const, error: "forbidden" };
  return { ok: true as const, items: await getSeasonReviewItems(batchId) };
}

export async function approveSeasonItem(itemId: string) {
  if (!(await can("content.queue.approve"))) return { ok: false as const, error: "forbidden" };
  const staff = await getCurrentStaff();
  const r = await approveItem(getSupabaseAdmin(), itemId, staff?.userId ?? "admin");
  return { ok: true as const, batchStatus: r.batchStatus, approved: r.approved, total: r.total };
}

export async function rejectSeasonItem(itemId: string, reason: string) {
  if (!(await can("content.queue.reject_verse"))) return { ok: false as const, error: "forbidden" };
  const staff = await getCurrentStaff();
  const r = await rejectItem(getSupabaseAdmin(), itemId, staff?.userId ?? "admin", reason || "rejected");
  return { ok: true as const, batchStatus: r.batchStatus, approved: r.approved, total: r.total };
}

export async function generateSeasonBatchAction(season: SeasonKey, year: number) {
  if (!(await can("content.generate"))) return { ok: false as const, error: "forbidden" };
  const db = getSupabaseAdmin();
  const selector = await makePoolVerseSelector(db);
  const r = await generateSeasonBatch({ db, season, year, selectVerse: selector });
  return { ok: true as const, ...r };
}
