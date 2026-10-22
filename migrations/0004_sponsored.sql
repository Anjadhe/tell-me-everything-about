-- Sponsored Explore cards. Served to everyone alongside the day's list; each
-- browser decides locally whether one fits its visitor (public/interests.js).
-- Views and clicks are counted per card in counters, with no visitor id.
CREATE TABLE IF NOT EXISTS sponsored (
  id TEXT PRIMARY KEY,              -- short, stable: [a-z0-9-]
  sponsor TEXT NOT NULL,            -- shown as "Sponsored · <sponsor>"
  topic TEXT NOT NULL,              -- goes into the visitor's prompt like any card
  hook TEXT NOT NULL,
  category TEXT NOT NULL,           -- one of public/categories.js
  tags TEXT NOT NULL DEFAULT '[]',  -- JSON array of tag ids
  angle TEXT NOT NULL DEFAULT '',
  figure TEXT NOT NULL DEFAULT '',
  figure_label TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',     -- optional https page, linked as is
  starts TEXT,                      -- YYYY-MM-DD, inclusive; null for now
  ends TEXT,                        -- YYYY-MM-DD, inclusive; null for open
  active INTEGER NOT NULL DEFAULT 1
);
