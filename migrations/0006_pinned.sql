-- Cards written by hand in the card manager (/admin/cards), shown to
-- everyone at the top of For you (and in their category) between starts
-- and ends. Like sponsored cards they are served with the day's list; unlike
-- them they carry no sponsor and are never counted.
CREATE TABLE IF NOT EXISTS pinned (
  id TEXT PRIMARY KEY,              -- short, stable: [a-z0-9-]
  topic TEXT NOT NULL,
  hook TEXT NOT NULL,
  category TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  kind TEXT NOT NULL DEFAULT 'topic',
  depth TEXT NOT NULL DEFAULT 'quick',
  surprise TEXT NOT NULL DEFAULT 'familiar',
  angle TEXT NOT NULL DEFAULT '',
  figure TEXT NOT NULL DEFAULT '',
  figure_label TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0, -- lower comes first
  starts TEXT,
  ends TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
