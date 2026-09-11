-- Daily counters. One row per (day, kind, key); the only thing ever counted
-- is how many times something happened. No topic, no id, no address.
CREATE TABLE IF NOT EXISTS counters (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, key)
);
