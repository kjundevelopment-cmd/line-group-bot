const KST_OFFSET_MS = 9 * 60 * 60 * 1000; // UTC+9, 서머타임 없음

/**
 * 오늘 날짜를 'YYYY-MM-DD' 형식으로, 한국 시간(KST) 자정 기준으로 반환한다.
 */
export function todayKST() {
  const now = new Date();
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  return kst.toISOString().slice(0, 10);
}
