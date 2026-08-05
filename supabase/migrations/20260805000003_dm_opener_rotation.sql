-- Per-subscriber rotation state for the DM-from-Him inspirational opener
-- (lib/dmOpenerRotation). Shuffle-then-cycle: `shuffled` is a random permutation
-- of opener-pool indices; `cursor` walks it; on exhausting the pool we reshuffle
-- and bump `cycle`. Keyed per recipient (consent_log id) so family teens desync.
-- Applied via MCP apply_migration (IGY workflow); repo-of-record copy.

CREATE TABLE IF NOT EXISTS public.dm_opener_rotation (
  consent_id  uuid PRIMARY KEY REFERENCES public.consent_log(id) ON DELETE CASCADE,
  shuffled    integer[]   NOT NULL,
  cursor      integer     NOT NULL DEFAULT 0,
  cycle       integer     NOT NULL DEFAULT 1,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Service-role only (matches consent_log / pending_signups): RLS on, no policies.
ALTER TABLE public.dm_opener_rotation ENABLE ROW LEVEL SECURITY;
