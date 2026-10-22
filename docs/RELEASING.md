# 릴리스 절차

새 기능이나 수정을 사용자에게 내보낼 때의 순서입니다.

## 왜 버전을 꼭 올려야 하나

`plugin.json`의 `version`이 같으면 사용자의 Claude Code는 새 커밋을 받지 않습니다. 코드를 바꿨다면 **반드시 버전을 올려야** 사용자에게 전달됩니다. 문서만 바꾼 경우에는 올리지 않아도 됩니다.

## 순서

1. **변경 기록 쓰기**: `CHANGELOG.md`의 `[Unreleased]` 내용을 새 버전 제목 아래로 옮깁니다.
2. **버전 올리기**: 두 파일의 `version`을 같은 값으로 바꿉니다. 다르면 `claude plugin tag`가 거부합니다.
   - `plugins/token-gauge/.claude-plugin/plugin.json`
   - `.claude-plugin/marketplace.json`
3. **검사**

   ```bash
   claude plugin validate .
   ```

   ```bash
   claude plugin validate ./plugins/token-gauge
   ```

   ```bash
   claude plugin test ./plugins/token-gauge
   ```

4. **커밋하고 push**: CI가 통과하는지 확인합니다.
5. **태그**: 공식 명령으로 `token-gauge--v<버전>` 태그를 만들고 push합니다.

   ```bash
   claude plugin tag ./plugins/token-gauge --push
   ```

6. **GitHub Release**: 태그에 릴리스를 만들고, 본문에는 `CHANGELOG.md`의 해당 버전 내용을 붙입니다.

   ```bash
   gh release create token-gauge--v1.2.0 --title "v1.2.0" --notes-file notes.md
   ```

## 지켜야 할 것

- **설정 키 이름(`cacheTtl` 등)은 바꾸지 않습니다.** 바꾸면 사용자가 저장한 값이 사라집니다. 꼭 바꿔야 하면 MAJOR 버전을 올리고 변경 기록에 적습니다.
- **mod 이름(`token-gauge`)과 마켓플레이스 이름은 바꾸지 않습니다.** 바꾸면 기존 설치 명령과 자동 업데이트가 끊깁니다.
- 새 Claude Code 버전에서 확인했다면 README의 "테스트한 환경"과 CI의 `CLAUDE_CODE_VERSION`을 함께 올립니다.
