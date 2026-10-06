import { ADMIN_USER_IDS, RANKING_TOP_N } from './config.js';
import { todayKST } from './date.js';
import * as db from './db.js';
import { getGroupMemberStatus } from './line.js';

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

function formatUserList(users) {
  if (users.length === 0) return '아직 이 방에서 대화한 유저가 없어요.';
  return users.map((u) => `${u.display_name || u.user_id} : ${u.user_id}`).join('\n');
}

/**
 * 텍스트가 !통계/!메인방/!순위/!유저목록/?통계/?메인방/?순위/?유저목록 중 하나인지 판별.
 * '!'와 '?'는 서로 완전히 독립된 메인방을 가리키는 별개의 명령 체계다.
 * @returns {{prefix: '!'|'?', command: '통계'|'메인방'|'순위'|'유저목록'} | null}
 */
export function matchCommand(text) {
  const m = text.trim().match(/^([!?])(통계|메인방|순위|유저목록)$/);
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

  if (command === '유저목록') {
    const users = await db.getKnownUsers(env, mainRoomId);
    return `[${prefix} 메인방 유저 목록]\n${formatUserList(users)}`;
  }

  const rows = await db.getDailyStats(env, mainRoomId, date);

  if (command === '통계') {
    return `[오늘의 마디수 통계]\n${formatStats(rows)}`;
  }

  if (command === '순위') {
    return `[오늘의 마디수 순위]\n${formatRanking(rows, RANKING_TOP_N)}`;
  }

  return null;
}

/**
 * "/체크" — 누군가의 메시지에 답장(인용)하며 입력하면 그 사람의 오늘 마디수를 알려준다.
 */
export function matchCheckCommand(text) {
  return text.trim() === '/체크';
}

export async function handleCheckCommand(event, env) {
  const source = event.source;
  if (!isAdmin(source.userId)) return null; // 관리자만 (다른 명령과 동일)
  if (source.type !== 'group') return null;

  // 메인방(! 또는 ?)으로 지정된 방에서만 동작
  const bangRoom = await db.getMainRoomId(env, '!');
  const questionRoom = await db.getMainRoomId(env, '?');
  if (source.groupId !== bangRoom && source.groupId !== questionRoom) return null;

  const quotedId = event.message.quotedMessageId;
  if (!quotedId) {
    return '확인할 사람의 메시지에 답장(길게 눌러 답장)하면서 /체크 를 입력해주세요.';
  }

  const targetUserId = await db.getMessageAuthor(env, source.groupId, quotedId);
  if (!targetUserId) {
    return '그 메시지의 작성자를 찾지 못했어요. (기능 적용 이후에 올라온 최근 메시지만 확인할 수 있어요)';
  }

  const row = await db.getUserDailyCount(env, source.groupId, targetUserId, todayKST());
  const name =
    (row && row.display_name) ||
    (await db.getKnownUserName(env, source.groupId, targetUserId)) ||
    targetUserId;
  const count = row ? row.message_count : 0;
  return `${name} : ${count}마디`;
}

// ============================================================
// !멘션 / ?멘션 — 이름에 특정 이모티콘이 들어간 멤버들을 한꺼번에 멘션
// ============================================================

// 그룹 이름 → 이름에 들어 있어야 하는 이모티콘
// (🐿️ 는 뒤에 보이지 않는 보조 문자가 붙을 수 있어서 기본 문자만 비교한다)
const MENTION_GROUPS = {
  노미클: '🪨',
  미클: '🪵',
  여자: '\u{1F43F}',
};

const MENTIONS_PER_MESSAGE = 20; // 말풍선 하나에 넣는 멘션 수(안전하게 20명씩)
const MAX_VERIFY = 40; // 멘션 전 방 멤버 확인은 한 번에 최대 40명 (무료 플랜 외부 호출 한도 50 대비)
const MAX_MESSAGES_PER_REPLY = 5; // LINE 회신 1번에 보낼 수 있는 말풍선 수

export function matchMentionCommand(text) {
  const m = text.trim().match(/^([!?])(?:멘션|맨션)(확인)?\s+(노미클|미클|여자)(?:\s+([\s\S]+))?$/);
  if (!m) return null;
  return { prefix: m[1], preview: !!m[2], group: m[3], message: (m[4] || '').trim() };
}

/**
 * @returns {Promise<{ text?: string, messages?: object[] } | null>}
 *   text: 단순 문구 회신 / messages: textV2 메시지 배열 / null: 무반응
 */
export async function handleMentionCommand(matched, event, env) {
  const source = event.source;
  if (!isAdmin(source.userId)) return null; // 관리자만
  if (source.type !== 'group') return null;

  const emoji = MENTION_GROUPS[matched.group];
  const users = await db.getKnownUsers(env, source.groupId);
  const targets = users.filter((u) => u.display_name && u.display_name.includes(emoji));

  // "!멘션확인 여자" — 멘션은 하지 않고, 대상으로 잡힌 멤버 이름만 보여준다. (점검용)
  if (matched.preview) {
    const list = targets.map((u) => u.display_name).join('\n');
    return {
      text:
        `[${matched.group} 대상 ${targets.length}명 / 봇이 아는 멤버 ${users.length}명]\n` +
        (list || '(없음)'),
    };
  }

  console.log('[mention]', matched.group, 'known =', users.length, 'targets =', targets.length);

  if (targets.length === 0) {
    return {
      text:
        `이름에 ${emoji}가 들어간 멤버를 찾지 못했어요.\n` +
        `(봇이 이 방에서 대화를 본 멤버 ${users.length}명 중 해당 이모티콘이 이름에 있는 사람이 없어요. ` +
        `한 번도 말하지 않은 멤버는 찾을 수 없어요)`,
    };
  }

  // LINE은 멘션 대상 중 "방에 없는 사람"이 한 명이라도 섞이면 메시지 전체를 거부한다.
  // 그래서 보내기 직전에 한 명씩 지금도 방에 있는지, 현재 이름에 이모티콘이 있는지 확인한다.
  const checked = await Promise.all(
    targets.slice(0, MAX_VERIFY).map(async (u) => ({
      u,
      s: await getGroupMemberStatus(env, source.groupId, u.user_id),
    }))
  );
  const apiWorks = checked.some((x) => x.s.status === 'ok');
  const valid = [];
  for (const { u, s } of checked) {
    if (s.status === 'gone') {
      // 방을 나간 사람 → 목록에서 제거 (API가 정상 응답하는 경우에만 안전하게 삭제)
      if (apiWorks) await db.deleteKnownUser(env, source.groupId, u.user_id);
    } else if (s.status === 'ok') {
      if (s.displayName !== u.display_name) {
        await db.refreshKnownUserName(env, source.groupId, u.user_id, s.displayName);
      }
      if (s.displayName.includes(emoji)) valid.push(u);
    } else {
      valid.push(u); // 확인 실패(일시 오류)면 기존 정보를 믿고 포함
    }
  }
  console.log('[mention] verified valid =', valid.length, 'of', checked.length);

  if (valid.length === 0) {
    return { text: `이름에 ${emoji}가 들어간 멤버를 찾지 못했어요. (방을 나갔거나 이름이 바뀐 멤버는 제외됐어요)` };
  }

  const limit = MENTIONS_PER_MESSAGE * MAX_MESSAGES_PER_REPLY;
  const picked = valid.slice(0, limit);

  const messages = [];
  for (let i = 0; i < picked.length; i += MENTIONS_PER_MESSAGE) {
    const chunk = picked.slice(i, i + MENTIONS_PER_MESSAGE);
    const substitution = {};
    const tokens = chunk.map((u, idx) => {
      const key = `u${idx}`;
      substitution[key] = { type: 'mention', mentionee: { type: 'user', userId: u.user_id } };
      return `{${key}}`;
    });
    // 멘션을 받은 사람이 알림에서 내용을 바로 볼 수 있게 말풍선마다 문구를 붙인다.
    messages.push({
      type: 'textV2',
      text: matched.message ? `${tokens.join(' ')}\n${matched.message}` : tokens.join(' '),
      substitution,
    });
  }

  if (targets.length > MAX_VERIFY) {
    messages[messages.length - 1].text += `\n(※ 대상 ${targets.length}명 중 ${MAX_VERIFY}명까지만 멘션됨)`;
  }
  return { messages };
}
