-- Candidate pool for a themed track: the APPROVED verse_theme_tags for that
-- track, joined back to kjv_verses for the source text. The join key rebuilds
-- "Book C:V" exactly the way generation builds verse_ref, so it matches.
-- Used by generate-daily-verse and generate-monthly-batch for themed tracks.
CREATE OR REPLACE FUNCTION public.get_theme_track_pool(p_track text)
RETURNS TABLE(book text, chapter integer, verse integer, text text)
LANGUAGE sql STABLE AS $function$
  SELECT k.book, k.chapter, k.verse, k.text
  FROM public.verse_theme_tags t
  JOIN public.kjv_verses k
    ON (k.book || ' ' || k.chapter || ':' || k.verse) = t.verse_ref
  WHERE t.theme_track = p_track AND t.status = 'approved';
$function$;
