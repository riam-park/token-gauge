# 변경 기록

이 저장소의 버전은 [유의적 버전](https://semver.org/lang/ko/)을 따릅니다. 릴리스마다 git 태그 `token-gauge--v<버전>`과 GitHub Release를 만듭니다.

- **MAJOR**: 설정 키 이름이 바뀌거나 빠지는 등, 기존 사용자가 손봐야 하는 변경
- **MINOR**: 새 기능, 새 설정
- **PATCH**: 버그 수정, 문구 수정

## [Unreleased]

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

[Unreleased]: https://github.com/riam-park/token-gauge/compare/token-gauge--v1.1.1...HEAD
[1.1.1]: https://github.com/riam-park/token-gauge/releases/tag/token-gauge--v1.1.1
[1.1.0]: https://github.com/riam-park/token-gauge/releases/tag/token-gauge--v1.1.0
[1.0.0]: https://github.com/riam-park/token-gauge/releases/tag/token-gauge--v1.0.0
