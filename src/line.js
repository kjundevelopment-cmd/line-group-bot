/**
 * LINE 웹훅 서명 검증 (X-Line-Signature 헤더).
 * Web Crypto API를 사용해 HMAC-SHA256(channelSecret, rawBody)을 계산하고
 * base64로 인코딩한 값이 헤더 값과 일치하는지 확인한다.
 */
export async function validateSignature(rawBody, channelSecret, signature) {
  if (!signature) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  const computed = arrayBufferToBase64(sigBuffer);
  return computed === signature;
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * replyToken으로 텍스트 메시지 회신.
 */
export async function replyMessage(env, replyToken, text) {
  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text }],
    }),
  });
  if (!res.ok) {
    console.error('replyMessage 실패:', res.status, await res.text());
  }
}

/**
 * 그룹 멤버 프로필(표시 이름) 조회. 실패 시 userId를 그대로 반환.
 */
export async function getGroupMemberDisplayName(env, groupId, userId) {
  try {
    const res = await fetch(
      `https://api.line.me/v2/bot/group/${groupId}/member/${userId}`,
      { headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` } }
    );
    if (!res.ok) throw new Error(`status ${res.status}`);
    const profile = await res.json();
    return profile.displayName;
  } catch (err) {
    console.error('프로필 조회 실패:', err.message);
    return userId;
  }
}
