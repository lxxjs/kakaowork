# kakaowork

macOS 카카오톡을 **터미널에서 Claude Code 같은 UI로** 쓰는 CLI입니다.

```
╭─── KakaoTalk Code v0.1.0 ────────────────────────────────────────────────────╮
│                                   │ Tips for getting started                 │
│         Welcome back 나!          │ /chats 로 채팅방을 골라 여세요           │
│                                   │ /open ㄱㅈ 처럼 초성으로 바로 열기       │
│              ▐▛███▜▌              │ 메시지를 입력하고 ⏎ 로 보내세요          │
│             ▝▜█████▛▘             │ ──────────────────────────────────────── │
│               ▘▘ ▝▝               │ Recent activity                          │
│                                   │ 민지 2 · 오후 3:28                       │
│      KakaoTalk 26.8.0 · 안 읽음 5 │ 개발팀 3 · 오후 3:10                     │
╰──────────────────────────────────────────────────────────────────────────────╯

⏺ Open(개발팀)
  ⎿  5명 · 메시지 40개 · 이전 메시지는 /more (PgUp)

⏺ 김팀장 배포 끝났습니다 🎉 오후 2:40
  다들 고생 많았어요

❯ 수고하셨습니다! 오후 2:41
  리뷰도 바로 볼게요

⏺ 가족 · 새 메시지 1
  ⎿  사진 봤어?

────────────────────────────────────────────────────────────────────────────────
❯ 개발팀에게 메시지 보내기
────────────────────────────────────────────────────────────────────────────────
  개발팀 | 멤버 5명 | 안 읽음 5
```

- 상대 메시지는 Claude Code 응답처럼 `⏺` 하나 아래로, 내 메시지는 Claude Code 프롬프트처럼 회색 띠 위에 `❯`로 표시됩니다. 연달아 보낸 메시지는 한 덩어리로 합쳐집니다.
- 입력창 아래 상태줄에 채팅방 이름, 멤버 수, 안 읽은 메시지 수가 나옵니다.
- Claude Code의 fullscreen 모드처럼 대체 화면(alternate screen)에서 실행됩니다. `/exit`로 나가면 터미널이 실행 전 화면으로 그대로 돌아가서, 이전 셸 기록은 남고 kakaowork 대화만 사라집니다. 대화는 앱 안에서 PgUp/PgDn, 마우스 휠, Shift+↑↓로 스크롤합니다(맨 위에서 PgUp을 누르면 이전 메시지를 더 불러옵니다).
- 방 열기 같은 동작은 도구 호출처럼 `⏺ Open(...)` / `⎿`로 표시됩니다.
- 다른 채팅방에 새 메시지가 오면 알림 줄이 뜹니다.

## 동작 방식

카카오톡에는 개인 메시지용 공식 API가 없습니다. 그래서 **실행 중인 macOS 카카오톡 앱을 손쉬운 사용(Accessibility) API로 읽고 조작합니다.**

```
kakaowork (Node + Ink TUI)  ──JSON lines──▶  dist/kakao-bridge (Swift)  ──AX API──▶  KakaoTalk.app
```

- `bridge/` — 창 없이 동작하는 Swift 헬퍼입니다. 채팅 목록과 메시지를 읽고, 방을 열고, 메시지를 보내며, 새 메시지를 감지(0.7초 폴링)합니다.
- `src/` — Claude Code와 같은 프레임워크(Ink)로 만든 터미널 UI입니다.
- 카카오톡 앱은 켜져 있기만 하면 됩니다. 기본으로 **숨김 모드**라 카카오톡 창은 숨겨진 채로 동작하고, 방을 열 때처럼 꼭 필요할 때만 잠깐 떴다가 다시 숨으면서 포커스가 터미널로 돌아옵니다. 카카오톡을 직접 열어 보다가 다른 앱으로 넘어가도 다시 숨겨집니다.

## 설치

필요한 것: macOS 12 이상(Apple Silicon·Intel), 카카오톡 맥 앱(로그인 상태). npm으로 설치하면 Node 22 이상도 필요합니다(Homebrew는 알아서 설치)

```sh
brew install lxxjs/tap/kakaowork   # Homebrew
npm i -g @lxxjs/kakaowork          # 또는 npm
kakaowork                          # 실행
```

설치 없이 한 번 써 보려면 `npx @lxxjs/kakaowork`를 실행하세요. Swift 헬퍼는 미리 빌드된 유니버설 바이너리로 들어 있어서 Xcode가 없어도 됩니다.
카카오톡이 꺼져 있으면 kakaowork가 알아서 실행합니다.

처음 실행하면 **손쉬운 사용 권한**을 요청합니다.
시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용에서 **지금 쓰는 터미널 앱**(Terminal, iTerm, Ghostty 등)을 켜 주세요.

## 사용법

```sh
kakaowork              # 시작
kakaowork 가족          # 바로 '가족' 방 열기 (초성도 가능: kakaowork ㄱㅈ)
kakaowork 나            # 나와의 채팅
kakaowork --no-hide    # 카카오톡 창을 숨기지 않고 쓰기
kakaowork --theme claude # 강조색을 Claude 주황으로 (기본: 카톡 노랑)
kakaowork --demo       # 카카오톡 없이 가상 데이터로 UI 체험
```

| 명령어 | 설명 |
| --- | --- |
| `/chats` | 채팅방 선택기 (↑↓, 입력해서 검색, ⏎ 열기) |
| `/open <이름>` | 채팅방 바로 열기 (이름 일부 또는 초성) |
| `/more [개수]` | 이전 메시지 더 불러오기 (`PgUp`) |
| `/close` | 현재 채팅방 닫기 |
| `/hide`, `/show` | 숨김 모드 켜기 / 끄기 (기본: 켜짐) |
| `/notify [on\|off]` | 다른 방 새 메시지 알림 |
| `/status` | 연결 상태 |
| `/clear` | 화면 지우기 |
| `/help`, `/exit` | 도움말 / 종료 |

| 키 | 동작 |
| --- | --- |
| `⏎` | 보내기 |
| `\⏎`, `⌥⏎` | 줄바꿈 |
| `tab` | 명령어·채팅방 이름 자동완성 |
| `↑` `↓` | 입력 기록 |
| `PgUp` `PgDn`, 휠, `Shift+↑↓` | 대화 스크롤 (맨 위에서 `PgUp`: 이전 메시지 불러오기) |
| `esc` | 메뉴 닫기 / 진행 중인 작업 취소 |
| `ctrl+c` 두 번 | 종료 |
| `?` (빈 입력창) | 단축키 보기 |

`/`로 시작하는 메시지를 보내려면 `//`로 시작하세요 (`//shrug` → `/shrug`).

## 알아둘 점

- **방을 열 때 카카오톡이 0.5초쯤 앞으로 나왔다가** 다시 숨고 터미널로 포커스가 돌아옵니다. 채팅 목록에서 Return 키를 눌러야 방이 열리기 때문입니다. 키를 보내기 전에 포커스가 채팅 목록에 있는지 먼저 확인하므로, 다른 창에 키가 들어가지는 않습니다.
- 열려 있는 채팅창의 메시지는 카카오톡이 **읽음 처리**합니다. 앱에서 방을 여는 것과 같습니다. 그래서 kakaowork가 연 창은 다른 방으로 옮기거나 종료할 때 닫습니다.
- 카카오톡 입력창에 쓰다 만 글이 있으면, 메시지를 보낸 뒤 그대로 되돌려 둡니다.
- 사진·이모티콘·파일은 `[사진]`, `[이모티콘]`, `[파일] 이름`으로 표시됩니다.
- 마우스 휠 스크롤을 위해 마우스 입력을 받기 때문에, 화면의 글자를 드래그해 복사하려면 터미널에 따라 Shift(또는 Option)를 누른 채 드래그하세요.
- 카카오톡 26.8.0(한국어 UI)에서 테스트했습니다. 카카오톡 화면 구조가 바뀌면 동작하지 않을 수 있습니다.
- 비공식 도구입니다. 본인 계정의 일상적인 대화에만 쓰고, 자동 대량 발송 같은 용도로는 쓰지 마세요.

## 개발

필요한 것: Xcode Command Line Tools(`swiftc`)

```sh
git clone https://github.com/lxxjs/kakaowork.git && cd kakaowork
npm install
npm run build          # Swift 헬퍼(유니버설) + TypeScript
npm link               # 개발 중인 코드를 `kakaowork` 명령으로 실행
npm test               # 단위 테스트 (편집기, 초성 검색, 메시지 묶기, 입력창 레이아웃)
npm run demo           # 가상 데이터로 실행

# 헬퍼를 단독으로 호출해 디버깅
dist/kakao-bridge status
dist/kakao-bridge chats '{"limit": 5}'
dist/kakao-bridge messages '{"title": "가족", "limit": 10}'
```

헬퍼 프로토콜은 줄 단위 JSON입니다. 요청은 `{"id":1,"cmd":"chats","limit":30}`, 응답은 `{"id":1,"ok":true,"result":…}` 형식입니다. 이벤트는 `{"event":"messages"|"chats"|"closed"|"app",…}` 형식으로 옵니다.

### 배포

```sh
scripts/release.sh            # patch 버전 릴리스 (minor, major, 1.2.3 도 가능)
SKIP_NPM=1 scripts/release.sh # npm 은 건너뛰고 GitHub + Homebrew 만
```

한 번에 버전 올리기 → 빌드·테스트 → GitHub 릴리스(`.tgz` 첨부) → npm 업로드 → [`lxxjs/homebrew-tap`](https://github.com/lxxjs/homebrew-tap)의 Formula 갱신까지 합니다. Formula 원본은 `packaging/kakaowork.rb`입니다.
