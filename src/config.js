// ============================================================
// 봇 운영 관련 하드코딩 설정
// ============================================================

// !메인방 명령을 쓸 수 있는 LINE userId 목록.
// 값을 채운 뒤 반드시 `npm run deploy`로 다시 배포해야 반영됩니다.
// userId 확인 방법: 배포 후 그룹방에서 아무 메시지나 치고
// `npm run tail` (wrangler tail) 로 실시간 로그를 보면
// "[event] message userId = Uxxxxxxxx..." 형태로 출력됩니다.
export const ADMIN_USER_IDS = [
   'Ud1708743a23b5963b55f02664868c9f9',
   'U39d53e2eb89d5c011a7e5b699a2f6333',
   'Ub98d82e3d9c3f93bb343043c1859c6bd',
   'U73fe450a441183922e99fdc3ee689924',
   'U8bcd29ea4335b6683b93da1de19c7793'
];

// 발화로 인정하는 최소 글자 수(공백 포함) — "3마디 이상" 기준
export const MIN_CHAR_COUNT = 3;

// 순위 명령(!순위)에서 몇 등까지 보여줄지
export const RANKING_TOP_N = 3;

// ============================================================
// 포인트 룰렛(가차) 관련 설정
// ============================================================
 
// 룰렛 1회 실행에 소모되는 티켓 수
export const ROULETTE_TICKET_COST = 1;
 
// "/룰렛" 입력 후 "/네"로 확인해야 하는 제한시간(초). 이 시간이 지나면 자동 취소됩니다.
export const ROULETTE_CONFIRM_TTL_SECONDS = 60;
 
// 상품과 당첨 확률(weight). weight 숫자가 클수록 더 자주 나옵니다.
// 예시 기준 전체 weight 합 100 중 "꽝"이 80이므로 당첨 확률은 20%.
// 숫자만 바꿔서 확률을 조정하면 됩니다.
export const ROULETTE_PRIZES = [
  { name: '🎉 1등 - 미클권', weight: 1 },
  { name: '🥈 2등 - 소환권', weight: 4 },
  { name: '🥉 3등 - 티켓+1', weight: 45 },
  { name: '😢 꽝 - 다음 기회에!', weight: 50 },
];
