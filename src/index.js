import { Hono } from 'hono';
import { validateSignature, replyMessage, getGroupMemberDisplayName } from './line.js';
import { matchCommand, handleCommand } from './commands.js';
import { getMainRoomId, incrementCount, deleteUserCounts } from './db.js';
import { todayKST } from './date.js';
import { MIN_CHAR_COUNT } from './config.js';

const app = new Hono();

app.get('/', (c) => c.text('line-group-bot (cloudflare workers) is running'));

app.post('/webhook', async (c) => {
  const signature = c.req.header('x-line-signature');
  const rawBody = await c.req.text();

  const valid = await validateSignature(rawBody, c.env.LINE_CHANNEL_SECRET, signature);
  if (!valid) {
    return c.text('invalid signature', 401);
  }

  const body = JSON.parse(rawBody);
  const events = body.events || [];

  // waitUntil로 넘기면 LINE에는 바로 200을 응답하면서 뒷단 처리를 계속할 수 있지만,
  // reply API 호출(replyToken 사용)은 이 요청 컨텍스트 안에서 끝내야 하므로 await로 처리한다.
  await Promise.all(events.map((event) => handleEvent(event, c.env)));

  return c.json({ status: 'ok' });
});

async function handleEvent(event, env) {
  if (event.source && event.source.userId) {
    console.log('[event]', event.type, 'userId =', event.source.userId, 'source =', event.source.type);
  }

  // 그룹방 멤버가 나가면 그 사람의 집계 기록을 통계/순위 목록에서 완전히 제거한다.
  if (event.type === 'memberLeft') {
    const groupId = event.source && event.source.groupId;
    const leftMembers = (event.left && event.left.members) || [];
    console.log('[debug] memberLeft groupId =', groupId, 'members =', JSON.stringify(leftMembers));
    if (groupId && leftMembers.length > 0) {
      await Promise.all(
        leftMembers
          .filter((m) => m.userId)
          .map((m) => deleteUserCounts(env, groupId, m.userId))
      );
    }
    return;
  }

  if (event.type !== 'message' || event.message.type !== 'text') {
    return;
  }

  const source = event.source;
  const text = event.message.text;
  const matched = matchCommand(text);
  console.log('[debug] text =', JSON.stringify(text), 'matched =', JSON.stringify(matched), 'source.type =', source.type);

  if (matched) {
    // 통계/순위/메인방 명령은 그룹방뿐 아니라 관리자의 1:1 DM에서도 동작한다.
    // (관리자 여부는 handleCommand 안에서 판별)
    const replyText = await handleCommand(matched, event, env);
    console.log('[debug] handleCommand result =', JSON.stringify(replyText));
    if (replyText) {
      await replyMessage(env, event.replyToken, replyText);
    }
    return;
  }

  // 마디 집계는 그룹방 활동만 대상으로 하므로, 명령어가 아닌 일반 메시지는
  // 여기서부터 그룹 메시지만 처리한다.
  if (source.type !== 'group') {
    return;
  }

  // 일반 메시지 → 글자 수(공백 포함) 계산 후, 이 방이 !메인방 또는 ?메인방으로
  // 지정된 방이라면 그에 맞는 집계에 반영한다.
  const bangMainRoomId = await getMainRoomId(env, '!');
  const questionMainRoomId = await getMainRoomId(env, '?');
  console.log('[debug] bangMainRoomId =', bangMainRoomId, 'questionMainRoomId =', questionMainRoomId);

  const isMonitoredRoom =
    source.groupId === bangMainRoomId || source.groupId === questionMainRoomId;
  console.log('[debug] isMonitoredRoom =', isMonitoredRoom);
  if (!isMonitoredRoom) {
    return; // 어느 쪽 메인방으로도 지정되지 않은 방은 집계하지 않음
  }

  const charCount = text.trim().length; // 공백 포함, 앞뒤 공백만 제거
  console.log('[debug] charCount =', charCount, 'MIN_CHAR_COUNT =', MIN_CHAR_COUNT);
  if (charCount < MIN_CHAR_COUNT) {
    return; // 3자 미만은 집계 제외
  }

  const displayName = await getGroupMemberDisplayName(env, source.groupId, source.userId);
  console.log('[debug] incrementCount 호출 →', source.groupId, source.userId, displayName, todayKST());
  await incrementCount(env, source.groupId, source.userId, displayName, todayKST());
  console.log('[debug] incrementCount 완료');
}

export default app;
