-- Cards written for an interest a visitor typed ("Roman history"), shared by
-- everyone who types the same thing. Holds the interest and its cards only:
-- never who asked. hits counts requests, for the dashboard and for choosing
-- which packs join the daily list. Unsuitable interests are kept (suitable =
-- 0, no cards) so they are not sent to Claude again.
CREATE TABLE IF NOT EXISTS interest_packs (
  key TEXT PRIMARY KEY,          -- slug of what was typed
  name TEXT NOT NULL,            -- the name Claude settled on, for display
  suitable INTEGER NOT NULL,
  data TEXT NOT NULL,            -- JSON array of cards
  created_at TEXT NOT NULL,
  last_used TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  alias_of TEXT                  -- another way of typing an interest whose
                                 -- pack is under that key ("history of rome"
                                 -- → "roman-history"); data is then empty
);
CREATE INDEX IF NOT EXISTS interest_packs_hits ON interest_packs (hits DESC);
