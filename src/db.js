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
