# 변경 기록

이 저장소의 버전은 [유의적 버전](https://semver.org/lang/ko/)을 따릅니다. 릴리스마다 git 태그 `token-gauge--v<버전>`과 GitHub Release를 만듭니다.

- **MAJOR**: 설정 키 이름이 바뀌거나 빠지는 등, 기존 사용자가 손봐야 하는 변경
- **MINOR**: 새 기능, 새 설정
- **PATCH**: 버그 수정, 문구 수정

## [Unreleased]

### 변경

- 막힌 프롬프트 질문 카드: 다른 mod의 훅이 프롬프트를 막으면, 막혔다는 경고(`Prompt dropped by a hook`)를 띄우기 전에 먼저 `보내기`/`취소`를 묻습니다. 경고 자리에는 고른 결과가 짧게 나옵니다. 카드를 닫으면 원래 경고가 나옵니다.

### 수정

- 데스크톱 앱에서 막힌 프롬프트 질문 카드가 뜨지 않던 문제: 데스크톱 입력은 엔진에 `sdk`로 들어와 사람 입력으로 보지 않았습니다. 화면이 붙은 세션의 `sdk` 입력도 묻습니다.
- README: `CLAUDE_CODE_PLUGIN_DIRS`나 `--plugin-dir`로 불러올 때도 token-gauge를 cache-tax보다 앞에 적어야 질문 카드가 뜬다는 안내를 넣었습니다.
- 그림과 PDF를 Read하면 `큰 파일 통째 읽기` 팁이 뜨던 문제: offset/limit가 맞지 않는 파일이라 팁을 띄우지 않습니다.
- 그림과 PDF Read 결과 크기 추정: base64 글자 수 대신 과금 방식대로 셉니다. 그림은 28×28 픽셀마다 1토큰(최대 4,784), PDF는 쪽마다 글자 2,250 + 쪽 그림 1,600으로 어림합니다. 상세 패널 `지난 턴`과 추정 배율에 반영됩니다.

## [1.3.2] - 2026-10-22

### 제거

- `desktopPlace` 설정과 입력창 아래 배치: 데스크톱 앱이 입력창 아래 힌트 자리를 보여 주지 않아 `below`로는 칩이 보이지 않았습니다. 칩은 터미널과 데스크톱 모두 입력창 위에 나옵니다. 저장해 둔 `desktopPlace` 값은 무시되므로 따로 손볼 것은 없습니다.

## [1.3.1] - 2026-10-22

### 수정

- 데스크톱 앱에서 칩 줄이 보이지 않던 문제: 1.3.0의 기본값 `desktopPlace` `below`는 칩을 입력창 아래 힌트 자리에 그렸지만, 데스크톱 앱은 그 자리를 한 줄 높이로 잘라 그려 칩이 모두 가려졌습니다. 기본값을 `above`(입력창 위, 1.2.x 동작)로 되돌립니다.
- `below`를 고르면 입력창 아래 힌트 옆에 칩 내용을 색 글자 한 줄로 보여 줍니다. 테두리, 막대, 버튼, 상세 패널은 없습니다.

## [1.3.0] - 2026-10-22

### 추가

- 모델 칩: 지금 모델과 effort를 네 번째 칩으로 보여 줍니다(`Opus 5.5 · high`). `/model`로 바꾸면 바로 반영하고, effort는 다음 요청부터 다시 보입니다. 폭이 좁으면 비용보다 먼저 접힙니다.
- 추정 보정: 상세 패널의 도구 결과 크기는 문자 수 / 4로 어림하던 값에, 턴 안 요청 사이의 실제 입력 증가량으로 구한 배율(0.5~2, 최근 10턴)을 곱합니다. 어림한 값에는 `≈`를 붙이고 배율을 `추정 ×1.32`처럼 함께 보여 줍니다.
- 상세 패널 `중복` 줄: 바뀌지 않은 파일을 같은 범위로 다시 읽은 횟수와 양(가장 많이 다시 읽은 파일 포함), 같은 도구가 같은 출력을 다시 낸 횟수와 양. 수정 후나 compaction 후의 재읽기는 세지 않습니다.
- 상세 패널 `compact` 줄: 직전 compaction 전후 크기와, 요약에 이름이 빠진 이번 세션 편집 파일. `인계 메모 후 새 세션` 버튼이 이 파일들을 메모에 넣으라고 함께 요청합니다.
- `desktopPlace` 설정: 데스크톱 앱에서 칩 줄을 입력창 아래(힌트 줄 밑, `below`, 기본값)에 둘지 입력창 위(`above`, 이전 동작)에 둘지 고릅니다. 터미널은 늘 입력창 위입니다.
- 막힌 프롬프트 질문 카드: 다른 mod의 훅이 사람이 보낸 프롬프트를 막으면 `다시 보내기`/`취소`를 묻습니다. `다시 보내기`는 같은 내용을 보내고, 막은 것이 cache-tax면 안내한 시간만큼 `/keepwarm`도 켭니다. `취소`나 카드를 닫으면 입력창에 되돌립니다. token-gauge가 막은 mod보다 `enabledPlugins`에서 앞에 있어야 합니다.
- 토큰 절약 팁 알림: 큰 파일 통째 읽기, 긴 명령 출력, 긴 subagent 결과, 변경 없는 재읽기 3회, 쓰지 않은 MCP 서버의 도구, 큰 메모리 파일을 세션마다 종류별로 한 번 알립니다. `alerts`를 따릅니다.

### 수정

- 상세 패널의 "지난 턴 큰 도구" 이름에 비밀값이 보이던 문제. Bash 명령, 검색 패턴, 설명을 보여 주기 전에 `Authorization`/`*-Key` 헤더, `Bearer` 토큰, `--token`/`--password`/PowerShell `-ApiKey` 같은 옵션 값, `API_TOKEN=`/`$env:GH_PAT =` 같은 환경 변수 값, URL과 `curl -u`의 `사용자:암호`, `ghp_`/`sk-` 같은 알려진 토큰 형태를 `***`로 가립니다. 최선의 노력일 뿐 모든 형식을 잡지는 않습니다.
- context 칩이 턴이 끝날 때만 갱신되던 문제. 답변 중에도 요청이 끝날 때마다, 그리고 3초마다 다시 읽습니다. `▲`는 그대로 턴이 시작할 때부터 늘어난 양입니다.
- Claude가 선택지를 묻는 질문 카드(AskUserQuestion)가 떠 있는 동안 칩 줄이 보이지 않던 문제. 이제 질문 카드 위에 칩 줄을 그립니다(버튼과 상세 패널 제외, 터미널은 한 줄 글자). 1.1.1의 수정은 입력창 위 band를 차지하는 survey에 대한 것이었고, 질문 카드는 band와 함께 입력창 자리를 대신해 따로 다뤄야 했습니다.
- 상세 패널을 열 때 오늘 합계를 읽지 못하면 처리되지 않은 오류가 남던 문제.
- WebFetch 이름이 `https://사용자:암호@호스트` 주소에서 `사용자:암호@호스트`를 그대로 보여 주던 문제. 이제 호스트만 보여 줍니다.

## [1.2.0] - 2026-10-22

### 추가

- 새 버전 알림: 하루 한 번 GitHub의 `marketplace.json`을 읽어 새 버전이 있으면 알려 줍니다. 보내는 정보는 없습니다. `alerts`를 끄거나 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`이면 확인하지 않습니다.

### 변경

- `handoffDir` 기본값을 `.temp`에서 빈 값으로 바꿨습니다. 비워 두면 `인계 메모 후 새 세션` 버튼이 메모를 파일 대신 Claude의 답변으로 요청하므로, 저장소 구조와 관계없이 쓸 수 있습니다. 파일로 받던 방식을 유지하려면 `/plugin configure token-gauge@token-gauge`에서 폴더를 적습니다. 설치할 때 `handoffDir=.temp`를 직접 넣은 경우에는 그 값이 그대로 남습니다.

## [1.1.1] - 2026-10-22

### 수정

- 터미널에서 상세 패널의 범주별 막대가 범주마다 빈 칸 하나(`▱`)로만 그려지던 문제. 이제 40칸 안에서 비율대로 색 블록(`█`)을 그리고, 남은 공간은 `░`로 표시합니다.
- 질문 카드(survey)가 입력창 위를 차지하는 동안 칩 줄이 통째로 사라지던 문제. 이제 칩 줄은 남기고, 버튼과 상세 패널만 숨겨 질문 자리를 비워 둡니다.

### 문서

- README를 다른 mod 저장소 형식에 맞춰 개편: 로고, 배지, 데스크톱·터미널 캡처 갤러리, 접히는 FAQ
- 변경 기록, 릴리스 절차(docs/RELEASING.md), GitHub Actions CI 추가
- 테스트한 환경에 터미널(Claude Code 2.1.306) 추가

## [1.1.0] - 2026-10-22

### 추가

- 설치할 때 묻는 설정(userConfig) 다섯 개: `cacheTtl`, `actionsAt`, `showCost`, `alerts`, `handoffDir`
- README에 "링크 주고 반영해줘" 설치, Claude가 따를 설치 순서, 테스트한 환경

## [1.0.0] - 2026-10-22

### 추가

- plan, context, 캐시 칩과 상태별 색(context는 날씨 아이콘)
- 상세 패널: 리셋 예측, 오늘 합계, 범주별 컨텍스트 막대, 지난 턴 큰 결과, 캐시 적중률
- compact 기준선 70% 이상에서 `/compact`, `인계 메모 후 새 세션` 버튼
- 캐시 10분 이하에서 `유지 90분` 버튼(cache-tax 연동), 작업 중 칩, 알림, `d` 단축키
- 초보자용 README와 토큰·캐시 절약 가이드

[Unreleased]: https://github.com/riam-park/token-gauge/compare/token-gauge--v1.3.2...HEAD
[1.3.2]: https://github.com/riam-park/token-gauge/releases/tag/token-gauge--v1.3.2
[1.3.1]: https://github.com/riam-park/token-gauge/releases/tag/token-gauge--v1.3.1
[1.3.0]: https://github.com/riam-park/token-gauge/releases/tag/token-gauge--v1.3.0
[1.2.0]: https://github.com/riam-park/token-gauge/releases/tag/token-gauge--v1.2.0
[1.1.1]: https://github.com/riam-park/token-gauge/releases/tag/token-gauge--v1.1.1
[1.1.0]: https://github.com/riam-park/token-gauge/releases/tag/token-gauge--v1.1.0
[1.0.0]: https://github.com/riam-park/token-gauge/releases/tag/token-gauge--v1.0.0
