# 변경 기록

이 저장소의 버전은 [유의적 버전](https://semver.org/lang/ko/)을 따릅니다. 릴리스마다 git 태그 `token-gauge--v<버전>`과 GitHub Release를 만듭니다.

- **MAJOR**: 설정 키 이름이 바뀌거나 빠지는 등, 기존 사용자가 손봐야 하는 변경
- **MINOR**: 새 기능, 새 설정
- **PATCH**: 버그 수정, 문구 수정

## [Unreleased]

### 수정

- 상세 패널의 "지난 턴 큰 도구" 이름에 비밀값이 보이던 문제. Bash 명령, 검색 패턴, 설명을 보여 주기 전에 `Authorization`/`*-Key` 헤더, `Bearer` 토큰, `--token`/`--password`/PowerShell `-ApiKey` 같은 옵션 값, `API_TOKEN=`/`$env:GH_PAT =` 같은 환경 변수 값, URL과 `curl -u`의 `사용자:암호`, `ghp_`/`sk-` 같은 알려진 토큰 형태를 `***`로 가립니다. 최선의 노력일 뿐 모든 형식을 잡지는 않습니다.
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

[Unreleased]: https://github.com/riam-park/token-gauge/compare/token-gauge--v1.2.0...HEAD
[1.2.0]: https://github.com/riam-park/token-gauge/releases/tag/token-gauge--v1.2.0
[1.1.1]: https://github.com/riam-park/token-gauge/releases/tag/token-gauge--v1.1.1
[1.1.0]: https://github.com/riam-park/token-gauge/releases/tag/token-gauge--v1.1.0
[1.0.0]: https://github.com/riam-park/token-gauge/releases/tag/token-gauge--v1.0.0
