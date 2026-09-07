export async function getMainRoomId(env, prefix) {
  const key = `mainRoomId:${prefix}`;
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?')
    .bind(key)
    .first();
  return row ? row.value : null;
}

export async function setMainRoomId(env, prefix, groupId) {
  const key = `mainRoomId:${prefix}`;
  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  )
    .bind(key, groupId)
    .run();
}

// ============================================================
// 룰렛방 지정 — !룰렛방남자 / !룰렛방여자 / ?룰렛방남자 / ?룰렛방여자
// prefix('!'|'?') × gender('male'|'female') 조합으로 4개의 독립된 방을 지정한다.
// 물리적으로 서로 다른 그룹방이면 roulette_tickets 등은 group_id로 이미 분리되어
// 저장되므로, 여기서는 "어느 방이 남자/여자 룰렛방인지"만 이름 붙여서 기억해둔다.
// ============================================================

export async function getRouletteRoomId(env, prefix, gender) {
  const key = `rouletteRoom:${prefix}:${gender}`;
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?')
    .bind(key)
    .first();
  return row ? row.value : null;
}

export async function setRouletteRoomId(env, prefix, gender, groupId) {
  const key = `rouletteRoom:${prefix}:${gender}`;
  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  )
    .bind(key, groupId)
    .run();
}

/**
 * 이 groupId가 (!룰렛방남자/!룰렛방여자/?룰렛방남자/?룰렛방여자) 중
 * 하나로라도 지정된 방인지 확인한다. !티켓등록을 엉뚱한 방에서 실행하는 실수를 막기 위함.
 */
export async function isDesignatedRouletteRoom(env, groupId) {
  const row = await env.DB.prepare(
    `SELECT 1 FROM settings WHERE key LIKE 'rouletteRoom:%' AND value = ? LIMIT 1`
  )
    .bind(groupId)
    .first();
  return !!row;
}

export async function incrementCount(env, groupId, userId, displayName, date) {
  await env.DB.prepare(
    `INSERT INTO daily_counts (group_id, user_id, display_name, date, message_count)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(group_id, user_id, date) DO UPDATE SET
       message_count = message_count + 1,
       display_name  = excluded.display_name`
  )
    .bind(groupId, userId, displayName, date)
    .run();
}

export async function getDailyStats(env, groupId, date) {
  const { results } = await env.DB.prepare(
    `SELECT user_id, display_name, message_count
     FROM daily_counts
     WHERE group_id = ? AND date = ?
     ORDER BY message_count DESC, display_name ASC`
  )
    .bind(groupId, date)
    .all();
  return results;
}

/**
 * 특정 그룹에서 특정 유저의 집계 기록을 전부 삭제한다.
 * (그룹방을 나간 사람을 통계/순위 목록에서 완전히 제외하기 위함)
 */
export async function deleteUserCounts(env, groupId, userId) {
  await env.DB.prepare(
    `DELETE FROM daily_counts WHERE group_id = ? AND user_id = ?`
  )
    .bind(groupId, userId)
    .run();
}

// ============================================================
// known_users — !유저목록 명령을 위해 "봇이 실제로 관측한 유저" 기록
// ============================================================

export async function isKnownUser(env, groupId, userId) {
  const row = await env.DB.prepare(
    `SELECT 1 FROM known_users WHERE group_id = ? AND user_id = ?`
  )
    .bind(groupId, userId)
    .first();
  return !!row;
}

export async function upsertKnownUser(env, groupId, userId, displayName) {
  await env.DB.prepare(
    `INSERT INTO known_users (group_id, user_id, display_name)
     VALUES (?, ?, ?)
     ON CONFLICT(group_id, user_id) DO UPDATE SET display_name = excluded.display_name`
  )
    .bind(groupId, userId, displayName)
    .run();
}

export async function getKnownUsers(env, groupId) {
  const { results } = await env.DB.prepare(
    `SELECT user_id, display_name FROM known_users WHERE group_id = ? ORDER BY display_name ASC`
  )
    .bind(groupId)
    .all();
  return results;
}

export async function deleteKnownUser(env, groupId, userId) {
  await env.DB.prepare(
    `DELETE FROM known_users WHERE group_id = ? AND user_id = ?`
  )
    .bind(groupId, userId)
    .run();
}

// ============================================================
// 포인트 룰렛(가차)
// ============================================================

export async function isRouletteActive(env, groupId) {
  const row = await env.DB.prepare(
    `SELECT active FROM roulette_events WHERE group_id = ?`
  )
    .bind(groupId)
    .first();
  return !!(row && row.active === 1);
}

/**
 * 티켓만 세팅한다. 이 자체로는 이벤트가 시작되지 않으며, 별도로 !이벤트시작을 실행해야
 * "/룰렛" 참여가 가능해진다. 같은 유저가 다시 등록되면 이전 값을 덮어쓴다.
 * entries: [{ userId, count }], displayNames: { [userId]: displayName }
 */
export async function registerRouletteTickets(env, groupId, entries, displayNames) {
  for (const { userId, count } of entries) {
    const displayName = (displayNames && displayNames[userId]) || userId;
    await env.DB.prepare(
      `INSERT INTO roulette_tickets (group_id, user_id, display_name, initial_count, remaining_count)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(group_id, user_id) DO UPDATE SET
         display_name    = excluded.display_name,
         initial_count   = excluded.initial_count,
         remaining_count = excluded.remaining_count`
    )
      .bind(groupId, userId, displayName, count, count)
      .run();
  }
}

/**
 * !이벤트시작 — 이 시점부터 "/룰렛" 참여가 가능해진다.
 */
export async function startRouletteEvent(env, groupId) {
  await env.DB.prepare(
    `INSERT INTO roulette_events (group_id, active, started_at, ended_at)
     VALUES (?, 1, ?, NULL)
     ON CONFLICT(group_id) DO UPDATE SET active = 1, started_at = excluded.started_at, ended_at = NULL`
  )
    .bind(groupId, new Date().toISOString())
    .run();
}

export async function getRemainingTickets(env, groupId, userId) {
  const row = await env.DB.prepare(
    `SELECT remaining_count FROM roulette_tickets WHERE group_id = ? AND user_id = ?`
  )
    .bind(groupId, userId)
    .first();
  return row ? row.remaining_count : 0;
}

export async function setPendingDraw(env, groupId, userId, cost, expiresAt) {
  await env.DB.prepare(
    `INSERT INTO roulette_pending (group_id, user_id, cost, expires_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(group_id, user_id) DO UPDATE SET cost = excluded.cost, expires_at = excluded.expires_at`
  )
    .bind(groupId, userId, cost, expiresAt)
    .run();
}

export async function getPendingDraw(env, groupId, userId) {
  return await env.DB.prepare(
    `SELECT cost, expires_at FROM roulette_pending WHERE group_id = ? AND user_id = ?`
  )
    .bind(groupId, userId)
    .first();
}

export async function clearPendingDraw(env, groupId, userId) {
  await env.DB.prepare(
    `DELETE FROM roulette_pending WHERE group_id = ? AND user_id = ?`
  )
    .bind(groupId, userId)
    .run();
}

export async function consumeTicketsAndDraw(env, groupId, userId, displayName, cost, prizeName) {
  await env.DB.prepare(
    `UPDATE roulette_tickets SET remaining_count = remaining_count - ?
     WHERE group_id = ? AND user_id = ?`
  )
    .bind(cost, groupId, userId)
    .run();

  await env.DB.prepare(
    `INSERT INTO roulette_draws (group_id, user_id, display_name, prize_name, drawn_at)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(groupId, userId, displayName, prizeName, new Date().toISOString())
    .run();
}

/**
 * 이벤트 종료: active를 끄고, 이번 이벤트 동안의 소모 티켓/당첨 내역을 집계해서 반환한다.
 */
export async function endRouletteEvent(env, groupId) {
  const eventRow = await env.DB.prepare(
    `SELECT started_at FROM roulette_events WHERE group_id = ?`
  )
    .bind(groupId)
    .first();
  const startedAt = eventRow ? eventRow.started_at : null;

  await env.DB.prepare(
    `UPDATE roulette_events SET active = 0, ended_at = ? WHERE group_id = ?`
  )
    .bind(new Date().toISOString(), groupId)
    .run();

  const { results: tickets } = await env.DB.prepare(
    `SELECT user_id, display_name, initial_count, remaining_count
     FROM roulette_tickets
     WHERE group_id = ?
     ORDER BY (initial_count - remaining_count) DESC`
  )
    .bind(groupId)
    .all();

  let draws = [];
  if (startedAt) {
    const result = await env.DB.prepare(
      `SELECT user_id, display_name, prize_name
       FROM roulette_draws
       WHERE group_id = ? AND drawn_at >= ?
       ORDER BY drawn_at ASC`
    )
      .bind(groupId, startedAt)
      .all();
    draws = result.results;
  }

  return { tickets, draws };
}
