-- When a collection's cards went into the daily list. Null means waiting:
-- the next publish adds them, through the same checks as the day's own cards.
ALTER TABLE interest_packs ADD COLUMN published_at TEXT;
