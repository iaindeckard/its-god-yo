-- Roster tracker: fold diacritics so "María" matches "Maria".
--
-- igy_norm_name is used by BOTH the church_roster_names.normalized_name generated
-- column AND (on-read) the v_church_roster_status match view, so updating it here
-- fixes matching on both sides at once. We fold accents with a plain translate()
-- rather than the unaccent extension so the function stays genuinely IMMUTABLE
-- (a generated column requires that) and carries no extension-schema dependency.
-- Covers the common Latin-1/Latin Extended letters that appear in first names.
CREATE OR REPLACE FUNCTION public.igy_norm_name(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(
    lower(translate(coalesce(t, ''),
      'ÁÀÄÂÃÅáàäâãåÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔÕóòöôõÚÙÜÛúùüûÑñÇçÝýŸÿ',
      'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCcYyYy')),
    '[^a-z0-9]', '', 'g')
$$;
