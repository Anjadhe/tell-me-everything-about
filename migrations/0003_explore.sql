-- One Explore list per day, the same for every visitor. Written by the daily
-- cron (src/explore.js); old days are pruned after a month.
CREATE TABLE IF NOT EXISTS explore (
  day TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);
