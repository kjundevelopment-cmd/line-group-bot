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

-- 그룹방에서 한 번이라도 메시지를 보낸 유저를 기록해둔다.
-- LINE의 "그룹 멤버 전체 목록" API는 인증/프리미엄 계정만 쓸 수 있어서,
-- 대신 봇이 실제로 관측한 유저를 여기 쌓아두고 !유저목록 명령으로 보여준다.
CREATE TABLE IF NOT EXISTS known_users (
  group_id     TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  display_name TEXT,
  PRIMARY KEY (group_id, user_id)
);

-- 이벤트(그룹)별 룰렛 진행 상태
CREATE TABLE IF NOT EXISTS roulette_events (
  group_id   TEXT PRIMARY KEY,
  active     INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  ended_at   TEXT
);

-- 유저별 보유 티켓 (이벤트 시작 시 !티켓등록으로 세팅됨)
CREATE TABLE IF NOT EXISTS roulette_tickets (
  group_id        TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  display_name    TEXT,
  initial_count   INTEGER NOT NULL DEFAULT 0,
  remaining_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, user_id)
);

-- 룰렛 당첨 기록 (이벤트 종료 시 요약에 사용)
CREATE TABLE IF NOT EXISTS roulette_draws (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id     TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  display_name TEXT,
  prize_name   TEXT NOT NULL,
  drawn_at     TEXT NOT NULL
);

-- "/룰렛" 입력 후 "/네" 확인을 기다리는 상태
CREATE TABLE IF NOT EXISTS roulette_pending (
  group_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  cost       INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
