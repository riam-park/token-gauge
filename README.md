# token-gauge

Claude Code 입력창 위에 **사용량 한도, 컨텍스트, 캐시 남은 시간**을 색깔 칩 세 개로 항상 보여 주는 mod입니다.
토큰을 언제 아끼고 언제 정리해야 하는지 한눈에 알 수 있습니다.

![token-gauge 칩 줄](docs/images/chips.png)

> 처음이라면 [토큰과 캐시, 초보자를 위한 정리](docs/TOKEN_TIPS.md)도 함께 읽어 보세요.

**가장 쉬운 설치**: Claude Code에 이 문장을 그대로 보내세요. Claude가 버전 확인, 설정 질문, 설치까지 진행합니다.

```text
https://github.com/riam-park/token-gauge 를 내 클로드에 반영해줘.
```

## 무엇을 보여 주나요

입력창 바로 위에 칩 세 개가 붙습니다.

1. **plan 칩**: 구독 플랜의 사용량 한도
   - `5h 6%`: 5시간 한도를 얼마나 썼는지. 막대 위 회색 눈금은 5시간 중 지난 시간입니다. 채움이 눈금보다 뒤에 있으면 여유, 앞서면 과속입니다.
   - `↻1h29`: 5시간 한도가 리셋되기까지 남은 시간
   - `7d 39% ↻2d13h`: 주간 한도 사용량과 리셋까지 남은 시간
   - `$0.63`: 이 세션 비용(정가 기준 추정. 구독자는 실제 청구 금액이 아님)
   - 칩 테두리 색은 주간 사용량 기준: 75% 미만 초록, 75% 이상 노랑, 90% 이상 빨강
2. **context 칩**: 대화가 얼마나 찼는지
   - `98.1k / 1M 10%`: 지금 대화 크기 / 최대 크기
   - 날씨 아이콘과 색: 자동 compact(대화 요약) 기준선에 얼마나 가까운지
     - ☀ 25% 미만, ☁ 50% 미만, ☂ 75% 미만, ☇ 90% 미만, ↯ 그 이상
   - `▲39.9k`: 지난 턴에 늘어난 양
   - `≈ 22턴`: 최근 속도로 몇 턴 뒤에 자동 compact가 올지
3. **❄ 캐시 칩**: 캐시가 식기까지 남은 시간
   - 10분 넘게 남으면 파랑, 10분 이하면 노랑, 만료되면 빨강 `cold`

### 상세 패널

칩 줄 끝의 `▾ 상세`를 누르면 아래에 펼쳐집니다.

- 5h, 7d: 정확한 리셋 시각, 페이스 판정(여유, 적정, 과속), "이 속도면 리셋 때 ~61%" 같은 예측
- 오늘: 이 컴퓨터의 모든 세션을 합친 오늘 비용, 세션 수, 입력·출력 토큰
- context: compact까지 남은 양, 평균 증가량, 무엇이 컨텍스트를 채우는지 범주별 막대
- 지난 턴: 결과가 가장 컸던 도구 호출 3개(글자 수로 추정)
- 캐시: 만료 시각, 적중률, 재기록 횟수

### 버튼과 알림

- **`/compact`, `인계 메모 후 새 세션`**: 컨텍스트가 compact 기준선의 70%를 넘으면 나타납니다.
  - `인계 메모 후 새 세션`은 "지금까지 작업을 `.temp/.../PROMPT_*.md`에 인계 메모로 정리해 달라"는 메시지를 대신 보냅니다. 새 세션은 직접 열고, 그 파일을 읽으라고 시키면 됩니다.
- **`유지 90분`**: 캐시가 10분 이하로 남았을 때 나타납니다. [cache-tax](#선택-캐시-유지-버튼-쓰기)를 설치한 경우에만 보입니다.
- **작업 중 칩 `⏳ 2:14 · 도구 9`**: Claude가 일하는 동안 경과 시간, 도구 호출 수, 실행 중인 subagent 수를 보여 줍니다.
- **알림**: 5시간 한도 90%, 컨텍스트 80%, 캐시 5분 남음을 지날 때 한 번씩 알려 줍니다.
- **단축키**: 칩 줄을 한 번 클릭하거나 `Ctrl+X` 다음 `Tab`으로 칩 줄에 포커스를 옮긴 뒤 `d`를 누르면 상세가 열리고 닫힙니다.

## 설치

### 1. 버전 확인

mod는 Claude Code **2.1.287 이상**에서 동작합니다.

- **Claude 데스크톱 앱(Code 탭)**: 입력창에 `/status`를 입력하고 **Claude Code** 줄의 버전을 확인합니다. 낮으면 앱을 업데이트하세요.
- **터미널(CLI)**: 아래 명령으로 확인하고, 낮으면 `claude update`로 업데이트합니다.

```bash
claude --version
```

### 2. 설치 명령 두 줄

Claude Code 입력창(데스크톱 앱이나 터미널)에 한 줄씩 입력합니다.

```text
/plugin marketplace add https://github.com/riam-park/token-gauge.git
```

```text
/plugin install token-gauge@token-gauge
```

설치 중에 설정 창이 뜨면 [설정](#설치할-때-묻는-설정)을 고릅니다. 창이 뜨지 않으면 기본값으로 설치되고, 나중에 바꿀 수 있습니다.
그다음 `/reload-plugins`를 입력하거나 새 세션을 엽니다. 메시지를 한 번 주고받으면 칩이 다 채워집니다.

### 3. 자동 업데이트 켜기 (권장)

`/plugin` → **Marketplaces** 탭 → **token-gauge** → **Enable auto-update**

## 설치할 때 묻는 설정

모두 기본값이 있어서 그냥 넘어가도 됩니다. 나중에 바꾸려면 `/plugin configure token-gauge@token-gauge`를 입력하거나 `/config`에서 찾습니다. 바꾼 값은 새 세션부터 적용됩니다.

- `cacheTtl` **캐시 수명**: `1h`(기본, 구독 로그인) 또는 `5m`(API 키, Bedrock 같은 클라우드 제공자)
- `actionsAt` **정리 버튼 기준(%)**: 컨텍스트가 compact 기준선의 몇 %일 때 `/compact`, 인계 메모 버튼을 보일지. 기본 70, 범위 50~95
- `showCost` **비용 표시**: 세션 비용과 오늘 비용(달러)을 보일지. 기본 켬
- `alerts` **알림**: 한도 90%, 컨텍스트 80%, 캐시 만료 임박 알림. 기본 켬
- `handoffDir` **인계 메모 폴더**: 인계 메모 버튼이 메모를 쓰라고 할 저장소 안 폴더. 기본 `.temp`

## 선택: 캐시 유지 버튼 쓰기

`유지 90분` 버튼은 [cache-tax](https://github.com/karanb192/cache-tax)(MIT, 다른 개발자의 mod)의 `/keepwarm` 명령을 실행합니다. 쓰려면 cache-tax도 설치합니다.

```text
/plugin marketplace add https://github.com/karanb192/claude-code-mods.git
```

```text
/plugin install cache-tax@claude-code-mods
```

- cache-tax는 캐시가 식은 채로 메시지를 보내려 하면 한 번 막고 다시 쓰는 비용을 알려 줍니다. 그대로 다시 보내면 전송됩니다.
- 캐시가 만료돼 전체를 다시 기록한 뒤에는 cache-tax가 3시간 동안 캐시 유지를 스스로 켭니다. 50분 넘게 쉴 때마다 작은 요청(ping)을 보내 사용량을 조금 씁니다. 끄려면 `/keepwarm off`.
- 이미 `claude-code-mods`라는 이름의 다른 마켓플레이스(hamzafer)를 등록했다면 이름이 겹쳐 추가되지 않습니다. 그때는 저장소를 내려받아 폴더로 불러오세요.

## 끄기, 지우기

- 잠깐 끄기: `/plugin` → **Installed** → token-gauge → Disable
- 지우기:

```text
/plugin uninstall token-gauge@token-gauge
```

## 자주 묻는 질문

**토큰을 더 쓰나요?**
아니요. token-gauge는 모델을 호출하지 않고, Claude가 읽는 내용에 아무것도 넣지 않습니다. Claude Code가 이미 가진 사용량 숫자를 화면에 그릴 뿐입니다. 토큰을 쓰는 건 버튼을 직접 눌렀을 때뿐입니다(`/compact`, 인계 메모 요청, 캐시 유지).

**어디서 보이나요?**
- Claude 데스크톱 앱 Code 탭: 보입니다.
- 터미널 `claude`: 보입니다. 막대는 SVG 대신 `▰▱` 문자로 그립니다.
- VS Code 확장의 채팅 패널, 데스크톱 앱의 WSL 세션, `claude -p`: 입력창 위 영역이 없어서 보이지 않습니다.

**처음 열었을 때 plan 칩이 비어 있어요.**
5h, 7d 사용량은 API 응답에 실려 오는 값이라 세션의 첫 응답 전에는 없습니다. 메시지를 한 번 주고받으면 나타납니다.

**캐시 시간이 정확한가요?**
마지막 요청이 끝난 시점부터 설정한 캐시 수명(기본 1시간)을 셉니다. API 키나 클라우드 제공자로 쓴다면 설정 `cacheTtl`을 `5m`으로 바꾸세요. 구독자도 한도를 넘어 추가 사용량(usage credits)으로 쓰는 동안에는 실제 캐시가 5분이 됩니다.

**안전한가요?**
mod는 내 권한으로 실행되는 코드입니다. token-gauge가 하는 일은 사용량 읽기, 화면 그리기, 이 mod 전용 저장소(오늘 합계)에 숫자 쓰기, 버튼을 눌렀을 때 명령 실행뿐입니다. 파일 쓰기와 네트워크 요청은 하지 않습니다. 설치 전에 직접 확인하려면 저장소를 내려받아 아래 명령을 실행해 보세요. 출력의 `hooks:`, `calls:` 줄에 하는 일이 모두 나옵니다.

```bash
claude plugin validate ./plugins/token-gauge
```

## 테스트한 환경

- **확인한 버전**: Claude Code **2.1.304**, Claude 데스크톱 앱 Code 탭, Windows 11 Pro, 구독 로그인(1시간 캐시)
  - 칩, 상세 패널, 범주별 막대를 실제 화면으로 확인했습니다.
  - `claude plugin validate`와 `claude plugin test`(10개)를 통과했습니다.
  - 마켓플레이스 추가, 설치, 새 세션 로드를 확인했습니다.
- **최소 버전**: 2.1.287 (mod 기능이 기본으로 켜지는 버전)
- **아직 실제 화면으로 확인하지 않은 것**: 터미널 `claude` 화면, macOS와 Linux, 캐시 10분 이하일 때의 `유지 90분` 버튼, compact 기준선 70% 이상일 때의 버튼

## Claude가 이 저장소를 설치할 때 따를 순서

> 사용자가 이 저장소 링크와 함께 "내 클로드에 반영해줘", "설치해줘"라고 하면 Claude는 아래 순서를 따릅니다.

1. **버전 확인**: 셸에서 `claude --version`을 실행합니다. 2.1.287 미만이면 사용자에게 알리고 `claude update`를 제안합니다. 데스크톱 앱이라면 사용자에게 `/status`의 **Claude Code** 버전을 물어봅니다.
2. **설정 묻기**: [설치할 때 묻는 설정](#설치할-때-묻는-설정)의 다섯 항목을 기본값과 함께 사용자에게 한 번에 묻습니다. 질문 도구(AskUserQuestion)가 있으면 그것을 씁니다. 사용자가 "기본값"이라고 하면 그대로 갑니다. 구독 로그인이 아니라면 `cacheTtl`을 `5m`으로 권합니다.
3. **마켓플레이스 추가**: 반드시 HTTPS 주소를 씁니다. `riam-park/token-gauge` 같은 짧은 형식은 SSH로 받으려다 known_hosts 오류로 실패할 수 있습니다.

   ```bash
   claude plugin marketplace add https://github.com/riam-park/token-gauge.git
   ```

4. **설치**: 셸의 `claude plugin install`은 설정 창을 띄우지 않으므로, 2단계에서 받은 값을 `--config`로 넘깁니다. 기본값과 같은 항목은 생략해도 됩니다.

   ```bash
   claude plugin install token-gauge@token-gauge --scope user --config cacheTtl=1h --config actionsAt=70 --config showCost=true --config alerts=true --config handoffDir=.temp
   ```

5. **확인**: `claude plugin list`에서 `token-gauge@token-gauge`가 `enabled`인지 봅니다.
6. **선택 설치**: 사용자에게 cache-tax(캐시 유지 버튼용)도 설치할지 묻고, 원하면 [선택: 캐시 유지 버튼 쓰기](#선택-캐시-유지-버튼-쓰기)의 두 명령을 같은 방식(`claude plugin marketplace add ...`, `claude plugin install cache-tax@claude-code-mods --scope user`)으로 실행합니다. 마켓플레이스 이름이 겹친다는 오류가 나면 사용자에게 알리고 건너뜁니다.
7. **마무리 안내**: 지금 세션에는 바로 보이지 않을 수 있으니 `/reload-plugins`를 입력하거나 새 세션을 열라고 알립니다. 첫 응답 뒤에 plan 칩이 채워진다는 것도 알립니다.

주의: 사용자의 `settings.json`을 직접 편집하지 말고 위 명령만 씁니다. 다른 플러그인은 건드리지 않습니다.

## 개발

```bash
claude plugin test ./plugins/token-gauge
```

```bash
claude --plugin-dir ./plugins/token-gauge
```

## 라이선스

MIT
