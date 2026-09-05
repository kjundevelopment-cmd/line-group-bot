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
 * - '!유저목록', '!이벤트종료' : 관리자 전용, 인자 없음
 * - '!티켓등록' : 관리자 전용, 첫 줄이 명령어이고 이후 줄이 "userId 개수"
 */
export function matchRouletteCommand(text) {
  const trimmed = text.trim();
 
  if (trimmed === '/룰렛') return { type: 'roulette' };
  if (trimmed === '/네') return { type: 'confirm' };
  if (trimmed === '/아니요') return { type: 'cancel' };
  if (trimmed === '!유저목록') return { type: 'listMembers' };
  if (trimmed === '!이벤트종료') return { type: 'endEvent' };
 
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
 
function formatEventSummary(tickets, draws) {
  const ticketLines = tickets.map((t) => {
    const consumed = t.initial_count - t.remaining_count;
    return `${t.display_name || t.user_id} : ${consumed}장 소모 (잔여 ${t.remaining_count}장)`;
  });
  const prizeLines = draws.map((d) => `${d.display_name || d.user_id} → ${d.prize_name}`);
 
  const ticketSection = ticketLines.length > 0 ? ticketLines.join('\n') : '기록 없음';
  const prizeSection = prizeLines.length > 0 ? prizeLines.join('\n') : '당첨 내역 없음';
 
  return `[이벤트 종료 - 티켓 소모 내역]\n${ticketSection}\n\n[당첨 내역]\n${prizeSection}`;
}
 
/**
 * 룰렛 관련 명령을 처리하고 회신할 텍스트를 반환한다. (null이면 회신 없음)
 */
export async function handleRouletteCommand(matched, event, env) {
  const source = event.source;
  const userId = source.userId;
 
  if (source.type !== 'group') {
    return null; // 룰렛은 그룹방 전용
  }
  const groupId = source.groupId;
 
  if (matched.type === 'listMembers') {
    if (!isAdmin(userId)) return null;
    const users = await db.getKnownUsers(env, groupId);
    if (users.length === 0) {
      return '아직 이 방에서 대화한 유저가 없어요. (봇이 실제로 관측한 유저만 기록됩니다)';
    }
    const lines = users.map((u) => `${u.display_name || u.user_id} : ${u.user_id}`);
    return `[이 방에서 확인된 유저 목록]\n${lines.join('\n')}`;
  }
 
  if (matched.type === 'registerTickets') {
    if (!isAdmin(userId)) return null;
    if (matched.entries.length === 0) {
      return '등록할 내용이 없어요. "!티켓등록" 다음 줄부터 "유저ID 개수"를 한 줄씩 적어주세요.\n예)\n!티켓등록\nU1234abcd... 10\nU5678efgh... 5';
    }
    const displayNames = {};
    for (const { userId: uid } of matched.entries) {
      displayNames[uid] = await getGroupMemberDisplayName(env, groupId, uid);
    }
    await db.registerRouletteTickets(env, groupId, matched.entries, displayNames);
    return `티켓 등록 완료! (${matched.entries.length}명)\n이벤트가 시작됐어요. "/룰렛"으로 참여할 수 있습니다.`;
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
