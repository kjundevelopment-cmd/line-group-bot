// ============================================================
// 봇 운영 관련 하드코딩 설정
// ============================================================

// !메인방 명령을 쓸 수 있는 LINE userId 목록.
// 값을 채운 뒤 반드시 `npm run deploy`로 다시 배포해야 반영됩니다.
// userId 확인 방법: 배포 후 그룹방에서 아무 메시지나 치고
// `npm run tail` (wrangler tail) 로 실시간 로그를 보면
// "[event] message userId = Uxxxxxxxx..." 형태로 출력됩니다.
export const ADMIN_USER_IDS = [
  // 'U1234567890abcdef1234567890abcdef',
  // 'Uabcdef1234567890abcdef1234567890',
];

// 발화로 인정하는 최소 어절(단어) 수 ("3마디 이상" 기준)
export const MIN_WORD_COUNT = 3;

// 순위 명령(!순위)에서 몇 등까지 보여줄지
export const RANKING_TOP_N = 3;
