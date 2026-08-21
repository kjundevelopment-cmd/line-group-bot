CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS daily_counts (
  group_id      TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  display_name  TEXT,
  date          TEXT NOT NULL,   -- 'YYYY-MM-DD' (KST 기준)
  message_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, user_id, date)
);
