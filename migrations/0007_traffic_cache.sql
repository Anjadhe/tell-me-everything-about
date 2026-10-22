-- Edge traffic for days that are over, fetched once from Cloudflare's
-- analytics and kept, so the dashboard asks Cloudflare only about today
-- (and yesterday until it is complete). Same rows the dashboard shows.
CREATE TABLE IF NOT EXISTS traffic_days (
  day TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
