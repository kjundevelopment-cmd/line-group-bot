{
  "name": "line-group-bot-workers",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "tail": "wrangler tail",
    "db:migrate:local": "wrangler d1 execute line-group-bot-db --local --file=./schema.sql",
    "db:migrate:remote": "wrangler d1 execute line-group-bot-db --remote --file=./schema.sql"
  },
  "dependencies": {
    "hono": "^4.6.0"
  },
  "devDependencies": {
    "wrangler": "^3.90.0"
  }
}

# line-group-bot (Cloudflare Workers 버전)

Express + better-sqlite3로 만들었던 버전을 **Cloudflare Workers + Hono + D1**로 다시 작성한
버전입니다. 기능(명령어, 집계 기준)은 기존과 완전히 동일하고, 실행 환경만 바뀌었습니다.

## 기존 버전과 달라진 점

| | Node.js(Express) 버전 | Workers(Hono) 버전 |
|---|---|---|
| 웹 프레임워크 | Express | Hono |
| DB | better-sqlite3 (로컬 파일) | D1 (Cloudflare의 SQLite 호환 DB, 영구 저장) |
| LINE 연동 | `@line/bot-sdk` | Web Crypto API로 서명 검증 + `fetch`로 REST 직접 호출 |
| 실행 방식 | 서버 프로세스를 계속 띄워둠 | 요청이 올 때만 실행되는 서버리스 (슬립/콜드스타트 개념 자체가 다름) |
| 배포 대상 | Render / Oracle Cloud VM 등 | Cloudflare (무료) |

명령어(`!통계`, `!메인방`, `!순위`)와 "3마디 이상만 집계" 규칙은 그대로입니다.

## 0. 사전 준비물

- Cloudflare 계정 (무료, **카드 등록 불필요**) — https://dash.cloudflare.com/sign-up
- Node.js 18 이상 설치되어 있는 PC
- LINE Developers Console의 Messaging API 채널 (이전 답변에서 이미 만드셨다면 그대로 재사용 가능)

## 1. 프로젝트 설치

```bash
cd line-group-bot-cf
npm install
```

`wrangler`(Cloudflare 공식 CLI)가 devDependency로 함께 설치됩니다.

## 2. Cloudflare 계정 연결

```bash
npx wrangler login
```

브라우저가 열리며 Cloudflare 계정 로그인 및 권한 허용을 요청합니다. 완료되면 터미널에
"Successfully logged in" 메시지가 뜹니다.

## 3. D1 데이터베이스 생성

```bash
npx wrangler d1 create line-group-bot-db
```

실행하면 아래와 비슷한 출력이 나옵니다.

```
[[d1_databases]]
binding = "DB"
database_name = "line-group-bot-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

여기서 `database_id` 값을 복사해서, 프로젝트의 **`wrangler.toml`** 파일에 있는
`REPLACE_WITH_YOUR_D1_DATABASE_ID` 부분에 붙여넣으세요.

## 4. 스키마(테이블) 적용

```bash
npm run db:migrate:remote
```

실제 운영에 쓰일 원격 D1에 `settings`, `daily_counts` 테이블을 생성합니다.
(로컬에서 `wrangler dev`로 테스트하고 싶다면 `npm run db:migrate:local`도 추가로 실행하세요.)

## 5. 시크릿(토큰) 등록

LINE 채널 access token / channel secret은 코드나 `wrangler.toml`에 직접 적지 않고,
Cloudflare에 암호화된 상태로 등록합니다.

```bash
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
# 프롬프트가 뜨면 LINE Developers Console > Messaging API 탭의
# Channel access token(long-lived) 값을 붙여넣고 Enter

npx wrangler secret put LINE_CHANNEL_SECRET
# 같은 방식으로 Channel secret 값을 붙여넣기
```

## 6. 배포

```bash
npm run deploy
```

성공하면 아래와 같은 형태의 URL이 출력됩니다.

```
https://line-group-bot.<your-subdomain>.workers.dev
```

Workers는 배포가 곧 즉시 반영이라, 로컬 터널링(ngrok 등) 없이 이 URL을 바로
공개 웹훅 주소로 쓸 수 있습니다.

## 7. LINE 쪽 웹훅 등록

1. LINE Developers Console → 해당 채널 → **Messaging API** 탭
2. Webhook URL에 `https://line-group-bot.<your-subdomain>.workers.dev/webhook` 입력 → **Verify** 클릭 (성공 응답 확인)
3. **Use webhook** 스위치 켜기
4. Auto-reply messages / Greeting messages는 꺼두는 것을 권장 (봇 응답과 겹치지 않도록)
5. 봇을 관리 중인 그룹방에 초대

## 8. 관리자(하드코딩 권한) 등록

`!메인방`처럼 민감한 명령은 `src/config.js`의 `ADMIN_USER_IDS` 배열에 등록된 사용자만
실행할 수 있습니다.

1. 위 상태로 그룹방에서 아무 메시지나 입력합니다.
2. 실시간 로그를 봅니다:
   ```bash
   npm run tail
   ```
3. 로그에 `[event] message userId = Uxxxxxxxx...` 형태로 출력되는 값을 복사합니다.
4. `src/config.js`를 열어 등록합니다.

   ```js
   export const ADMIN_USER_IDS = [
     'U1234567890abcdef1234567890abcdef',
   ];
   ```

5. **반드시 다시 배포해야 반영됩니다** (Workers는 재시작 개념이 없고, 배포 = 즉시 적용).

   ```bash
   npm run deploy
   ```

## 9. 동작 확인

그룹방에서 순서대로 입력해보세요.

1. `!메인방` → "이 방을 메인방으로 지정했어요." 응답 (관리자 계정으로 입력해야 함)
2. 아무 문장이나 3어절 이상으로 몇 번 대화
3. `!통계` → 오늘 사용자별 마디수 목록
4. `!순위` → 오늘 1~3위

## 10. 비용 관련 참고

- Workers 무료 플랜: 하루 10만 요청, 요청당 CPU 10ms — 텍스트 몇 마디 처리하는 이 봇에는 충분합니다.
  (LINE API 호출을 기다리는 시간은 CPU 사용 시간에 포함되지 않습니다.)
- D1 무료 플랜: 5GB 저장 공간, 하루 읽기 500만 행 / 쓰기 10만 행 — 그룹방 하나 통계 용도로는
  사실상 소진할 일이 없습니다.
- 카드 등록 없이 위 한도 안에서는 과금되지 않습니다.

## 파일 구성

```
line-group-bot-cf/
├── src/
│   ├── index.js      # Hono 앱, 웹훅 라우팅, 이벤트 처리
│   ├── commands.js   # !통계 / !메인방 / !순위 명령 처리
│   ├── db.js          # D1 데이터 접근 (settings, daily_counts)
│   ├── line.js         # LINE 서명 검증 + Messaging API fetch 호출
│   ├── date.js          # KST 기준 오늘 날짜 계산
│   └── config.js         # 관리자 userId, 마디 기준 등 하드코딩 설정
├── schema.sql              # D1 테이블 스키마
├── wrangler.toml             # Workers/D1 배포 설정
└── package.json
```

## 알려진 제약 (기존 버전과 동일)

- 봇이 그룹에 초대되기 이전 대화 이력은 집계할 수 없습니다 (실시간 웹훅만 수신).
- `getGroupMemberDisplayName`은 해당 사용자가 아직 그 그룹의 멤버일 때만 정상 동작하며,
  탈퇴한 사용자는 마지막으로 저장된 이름으로 표시됩니다.
- "메인방"은 한 곳만 지정 가능한 단일 설정입니다.

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS daily_counts (
  group_id      TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  display_name  TEXT,
  date          TEXT NOT NULL,   -- 'YYYY-MM-DD' (KST 기준)
  message_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, user_id, date)
);

name = "line-group-bot"
main = "src/index.js"
compatibility_date = "2026-08-01"

# wrangler d1 create line-group-bot-db 실행 후 출력되는 database_id를
# 아래 database_id 값에 붙여넣으세요. (README 2단계 참고)
[[d1_databases]]
binding = "DB"
database_name = "line-group-bot-db"
database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID"
