import { ADMIN_USER_IDS, RANKING_TOP_N } from './config.js';
import { todayKST } from './date.js';
import * as db from './db.js';

export function isAdmin(userId) {
  return ADMIN_USER_IDS.includes(userId);
}

function formatStats(rows) {
  if (rows.length === 0) return '오늘 집계된 대화가 아직 없습니다.';
  return rows
    .map((r) => `${r.display_name || r.user_id} : ${r.message_count}마디`)
    .join('\n');
}

function formatRanking(rows, topN) {
  if (rows.length === 0) return '오늘 집계된 대화가 아직 없습니다.';
  const medal = ['🥇', '🥈', '🥉'];
  return rows
    .slice(0, topN)
    .map((r, i) => `${medal[i] || `${i + 1}위`} ${r.display_name || r.user_id} - ${r.message_count}마디`)
    .join('\n');
}

/**
 * 텍스트가 !통계/!메인방/!순위/?통계/?메인방/?순위 중 하나인지 판별.
 * '!'와 '?'는 서로 완전히 독립된 메인방을 가리키는 별개의 명령 체계다.
 * @returns {{prefix: '!'|'?', command: '통계'|'메인방'|'순위'} | null}
 */
export function matchCommand(text) {
  const m = text.trim().match(/^([!?])(통계|메인방|순위)$/);
  if (!m) return null;
  return { prefix: m[1], command: m[2] };
}

/**
 * 명령을 처리하고 회신할 텍스트를 반환한다. (null이면 회신 없음)
 */
export async function handleCommand(matched, event, env) {
  const { prefix, command } = matched;
  const source = event.source;
  const userId = source.userId;

  // 통계/순위/메인방 전부 관리자만 사용 가능
  const adminCheck = isAdmin(userId);
  console.log('[debug] handleCommand userId =', userId, 'isAdmin =', adminCheck, 'ADMIN_USER_IDS =', JSON.stringify(ADMIN_USER_IDS));
  if (!adminCheck) {
    return null; // 관리자가 아니면 조용히 무시 (권한 없음을 노출하지 않음)
  }

  if (command === '메인방') {
    if (source.type !== 'group') {
      return '그룹방에서만 메인방으로 지정할 수 있어요.';
    }
    await db.setMainRoomId(env, prefix, source.groupId);
    return `이 방을 '${prefix}' 명령어 전용 메인방으로 지정했어요. 지금부터 이 방의 대화를 집계합니다.`;
  }

  const mainRoomId = await db.getMainRoomId(env, prefix);
  if (!mainRoomId) {
    return `아직 '${prefix}' 명령어용 메인방이 지정되지 않았어요. 해당 방에서 ${prefix}메인방 을 입력해주세요.`;
  }

  // 통계/순위는 그 프리픽스의 메인방으로 지정된 방이거나,
  // (이미 위에서 관리자 확인이 끝났으므로) 관리자의 1:1 DM에서 조회할 수 있음
  const inMainRoom = source.type === 'group' && source.groupId === mainRoomId;
  const isDirectMessage = source.type === 'user';
  if (!inMainRoom && !isDirectMessage) {
    return null; // 메인방도 아니고 1:1 DM도 아니면 아무 반응도 하지 않음
  }

  const date = todayKST();
  const rows = await db.getDailyStats(env, mainRoomId, date);

  if (command === '통계') {
    return `[오늘의 마디수 통계]\n${formatStats(rows)}`;
  }

  if (command === '순위') {
    return `[오늘의 마디수 순위]\n${formatRanking(rows, RANKING_TOP_N)}`;
  }

  return null;
}
