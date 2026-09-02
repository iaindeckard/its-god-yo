-- Per-campaign discovery language for the church-outreach agent.
--
-- Default 'en' preserves existing behavior for every current campaign. 'es'
-- switches discovery into Spanish-speaking-church mode: the source-lane rotation
-- leads with the Spanish church directory (churchdirectoryusa.com Spanish-speaking
-- churches) and every round's prompt requires public evidence that the
-- congregation serves Spanish speakers (see lib/outreach/directory-sources.ts and
-- lib/outreach/discovery.ts).
--
-- NOTE (IGY convention): this column was applied to the remote project via MCP
-- apply_migration; this file is the committed record of that change. Do not run
-- `supabase db push` against IGY.
alter table public.outreach_campaigns
  add column if not exists search_language text not null default 'en'
  check (search_language in ('en', 'es'));

comment on column public.outreach_campaigns.search_language is
  'Discovery language for this campaign: en (default) or es (Spanish-speaking churches).';
