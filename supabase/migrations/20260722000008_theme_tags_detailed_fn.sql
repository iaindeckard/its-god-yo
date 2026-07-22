-- Review-queue helper: proposed/approved/rejected theme tags for a track, joined
-- to the KJV source text so the human reviewer sees the actual verse. Used by
-- the /admin/theme-tags review UI.
CREATE OR REPLACE FUNCTION public.get_theme_tags_detailed(p_track text, p_status text)
RETURNS TABLE(id uuid, verse_ref text, status text, confidence numeric, rationale text, proposed_by text, kjv_text text)
LANGUAGE sql STABLE AS $function$
  SELECT t.id, t.verse_ref, t.status, t.confidence, t.rationale, t.proposed_by, k.text
  FROM public.verse_theme_tags t
  LEFT JOIN public.kjv_verses k
    ON (k.book || ' ' || k.chapter || ':' || k.verse) = t.verse_ref
  WHERE t.theme_track = p_track AND t.status = p_status
  ORDER BY t.confidence DESC NULLS LAST, t.created_at;
$function$;
