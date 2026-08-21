import { Hono } from 'hono';
import { validateSignature, replyMessage, getGroupMemberDisplayName } from './line.js';
import { matchCommand, handleCommand } from './commands.js';
import { getMainRoomId, incrementCount } from './db.js';
import { todayKST } from './date.js';
import { MIN_WORD_COUNT } from './config.js';

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

  if (event.type !== 'message' || event.message.type !== 'text') {
    return;
  }

  const source = event.source;
  // 그룹방 활동 집계가 목적이므로 그룹 메시지만 처리
  if (source.type !== 'group') {
    return;
  }

  const text = event.message.text;
  const matched = matchCommand(text);
  console.log('[debug] text =', JSON.stringify(text), 'matched =', JSON.stringify(matched), 'groupId =', source.groupId);

  if (matched) {
    const replyText = await handleCommand(matched, event, env);
    console.log('[debug] handleCommand result =', JSON.stringify(replyText));
    if (replyText) {
      await replyMessage(env, event.replyToken, replyText);
    }
    return;
  }

  // 일반 메시지 → 마디(어절) 수 계산 후, 이 방이 !메인방 또는 ?메인방으로
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

  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  console.log('[debug] wordCount =', wordCount, 'MIN_WORD_COUNT =', MIN_WORD_COUNT);
  if (wordCount < MIN_WORD_COUNT) {
    return; // 3마디 미만은 집계 제외
  }

  const displayName = await getGroupMemberDisplayName(env, source.groupId, source.userId);
  console.log('[debug] incrementCount 호출 →', source.groupId, source.userId, displayName, todayKST());
  await incrementCount(env, source.groupId, source.userId, displayName, todayKST());
  console.log('[debug] incrementCount 완료');
}

export default app;
