import {
  ADMIN_USER_IDS,
  ROULETTE_TICKET_COST,
  ROULETTE_CONFIRM_TTL_SECONDS,
  ROULETTE_PRIZES,
} from './config.js';
import { getGroupMemberDisplayName } from './line.js';
import * as db from './db.js';

function isAdmin(userId) {
  return ADMIN_USER_IDS.includes(userId);
}

/**
 * weight 기반 가중 랜덤으로 상품 하나를 뽑는다.
 */
export function pickPrize() {
  const total = ROULETTE_PRIZES.reduce((sum, p) => sum + p.weight, 0);
  let r = Math.random() * total;
  for (const prize of ROULETTE_PRIZES) {
    if (r < prize.weight) return prize.name;
    r -= prize.weight;
  }
  return ROULETTE_PRIZES[ROULETTE_PRIZES.length - 1].name; // 부동소수점 오차 대비 안전장치
}

/**
 * 텍스트가 룰렛 관련 명령인지 판별한다.
 * - '/룰렛', '/네', '/아니요' : 누구나
 * - '!룰렛방남자', '!룰렛방여자', '?룰렛방남자', '?룰렛방여자' : 관리자 전용, 방 지정
 * - '!이벤트종료' : 관리자 전용, 인자 없음
 * - '!티켓등록' : 관리자 전용, 첫 줄이 명령어이고 이후 줄이 "userId 개수"
 */
export function matchRouletteCommand(text) {
  const trimmed = text.trim();

  if (trimmed === '/룰렛') return { type: 'roulette' };
  if (trimmed === '/네') return { type: 'confirm' };
  if (trimmed === '/아니요') return { type: 'cancel' };
  if (trimmed === '!이벤트시작') return { type: 'startEvent' };
  if (trimmed === '!이벤트종료') return { type: 'endEvent' };

  const roomMatch = trimmed.match(/^([!?])룰렛방(남자|여자)$/);
  if (roomMatch) {
    const gender = roomMatch[2] === '남자' ? 'male' : 'female';
    return { type: 'setRouletteRoom', prefix: roomMatch[1], gender };
  }

  if (trimmed === '!티켓등록' || trimmed.startsWith('!티켓등록\n')) {
    const lines = trimmed.split('\n').slice(1); // 첫 줄(명령어 자체) 제외
    const entries = [];
    for (const line of lines) {
      const m = line.trim().match(/^(U[0-9a-f]{20,})\s+(\d+)\s*$/i);
      if (m) {
        entries.push({ userId: m[1], count: parseInt(m[2], 10) });
      }
    }
    return { type: 'registerTickets', entries };
  }

  return null;
}

/**
 * 이벤트 종료 정산 — 사람별로 "몇 장 소모 → 받을 상품"만 간단히 보여준다.
 * "꽝"은 실제로 수령할 상품이 아니므로 목록에서 제외한다 (소모 티켓 수에는 포함됨).
 */
function formatEventSummary(tickets, draws) {
  if (tickets.length === 0) {
    return '[이벤트 종료 정산]\n기록 없음';
  }

  const prizesByUser = new Map(); // userId -> Map<prizeName, count>
  for (const d of draws) {
    if (d.prize_name.includes('꽝')) continue;
    if (!prizesByUser.has(d.user_id)) {
      prizesByUser.set(d.user_id, new Map());
    }
    const counts = prizesByUser.get(d.user_id);
    counts.set(d.prize_name, (counts.get(d.prize_name) || 0) + 1);
  }

  const lines = tickets.map((t) => {
    const consumed = t.initial_count - t.remaining_count;
    const counts = prizesByUser.get(t.user_id);
    const prizeText =
      !counts || counts.size === 0
        ? '받은 상품 없음'
        : Array.from(counts.entries())
            .map(([name, count]) => (count > 1 ? `${name} x${count}` : name))
            .join(', ');
    return `${t.display_name || t.user_id} : ${consumed}장 소모 → ${prizeText}`;
  });

  return `[이벤트 종료 정산]\n${lines.join('\n')}`;
}

/**
 * 룰렛 관련 명령을 처리하고 회신할 텍스트를 반환한다. (null이면 회신 없음)
 */
export async function handleRouletteCommand(matched, event, env) {
  const source = event.source;
  const userId = source.userId;
  console.log('[debug][roulette] matched.type =', matched.type, 'userId =', userId, 'source.type =', source.type, 'isAdmin =', isAdmin(userId), 'ADMIN_USER_IDS =', JSON.stringify(ADMIN_USER_IDS));

  if (source.type !== 'group') {
    return null; // 룰렛은 그룹방 전용
  }
  const groupId = source.groupId;

  if (matched.type === 'setRouletteRoom') {
    if (!isAdmin(userId)) return null;
    await db.setRouletteRoomId(env, matched.prefix, matched.gender, groupId);
    const genderLabel = matched.gender === 'male' ? '남자' : '여자';
    return `이 방을 '${matched.prefix}룰렛방${genderLabel}'(으)로 지정했어요. 이제 이 방에서 "!티켓등록"으로 티켓을 등록할 수 있습니다.`;
  }

  if (matched.type === 'registerTickets') {
    if (!isAdmin(userId)) return null;
    const designated = await db.isDesignatedRouletteRoom(env, groupId);
    if (!designated) {
      return '이 방은 아직 룰렛방으로 지정되지 않았어요. 먼저 "!룰렛방남자", "!룰렛방여자", "?룰렛방남자", "?룰렛방여자" 중 하나로 이 방을 지정해주세요.';
    }
    if (matched.entries.length === 0) {
      return '등록할 내용이 없어요. "!티켓등록" 다음 줄부터 "유저ID 개수"를 한 줄씩 적어주세요.\n예)\n!티켓등록\nU1234abcd... 10\nU5678efgh... 5';
    }
    const displayNames = {};
    for (const { userId: uid } of matched.entries) {
      displayNames[uid] = await getGroupMemberDisplayName(env, groupId, uid);
    }
    await db.registerRouletteTickets(env, groupId, matched.entries, displayNames);
    return `티켓 등록 완료! (${matched.entries.length}명)\n"!이벤트시작"을 입력하면 이벤트가 시작됩니다.`;
  }

  if (matched.type === 'startEvent') {
    if (!isAdmin(userId)) return null;
    const designated = await db.isDesignatedRouletteRoom(env, groupId);
    if (!designated) {
      return '이 방은 아직 룰렛방으로 지정되지 않았어요. 먼저 "!룰렛방남자", "!룰렛방여자", "?룰렛방남자", "?룰렛방여자" 중 하나로 이 방을 지정해주세요.';
    }
    await db.startRouletteEvent(env, groupId);
    return '이벤트가 시작됐어요! 이제 "/룰렛"으로 참여할 수 있습니다.';
  }

  if (matched.type === 'roulette') {
    const active = await db.isRouletteActive(env, groupId);
    if (!active) {
      return null; // 진행 중인 이벤트가 없으면 조용히 무시
    }
    const remaining = await db.getRemainingTickets(env, groupId, userId);
    if (remaining < ROULETTE_TICKET_COST) {
      return `티켓이 부족해서 진행할 수 없어요. (보유 ${remaining}장, 필요 ${ROULETTE_TICKET_COST}장)`;
    }
    const expiresAt = new Date(Date.now() + ROULETTE_CONFIRM_TTL_SECONDS * 1000).toISOString();
    await db.setPendingDraw(env, groupId, userId, ROULETTE_TICKET_COST, expiresAt);
    return `티켓 ${ROULETTE_TICKET_COST}장이 소모됩니다. 진행하시겠습니까? ('/네' 또는 '/아니요'로 답해주세요)`;
  }

  if (matched.type === 'confirm') {
    const pending = await db.getPendingDraw(env, groupId, userId);
    if (!pending) return null; // 대기 중인 룰렛이 없으면 무시

    if (new Date(pending.expires_at).getTime() < Date.now()) {
      await db.clearPendingDraw(env, groupId, userId);
      return '확인 시간이 지났어요. 다시 "/룰렛"을 입력해주세요.';
    }

    const remaining = await db.getRemainingTickets(env, groupId, userId);
    if (remaining < pending.cost) {
      await db.clearPendingDraw(env, groupId, userId);
      return `티켓이 부족해서 진행할 수 없어요. (보유 ${remaining}장)`;
    }

    const displayName = await getGroupMemberDisplayName(env, groupId, userId);
    const prize = pickPrize();
    await db.consumeTicketsAndDraw(env, groupId, userId, displayName, pending.cost, prize);
    await db.clearPendingDraw(env, groupId, userId);

    const newRemaining = remaining - pending.cost;
    return `${prize}\n(잔여 티켓: ${newRemaining}장)`;
  }

  if (matched.type === 'cancel') {
    const pending = await db.getPendingDraw(env, groupId, userId);
    if (!pending) return null;
    await db.clearPendingDraw(env, groupId, userId);
    return '룰렛 진행을 취소했어요.';
  }

  if (matched.type === 'endEvent') {
    if (!isAdmin(userId)) return null;
    const { tickets, draws } = await db.endRouletteEvent(env, groupId);
    return formatEventSummary(tickets, draws);
  }

  return null;
}
