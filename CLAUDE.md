# CLAUDE.md

## 이 저장소

한림대 컴퓨터구조 수업용 RISC-V 시뮬레이터. 현재 1단계(엔진 결정용 탐침)만 있다.
`probe/REPORT.md` 가 현재 상태와 결정이다.

- `docs/engine-protocol.md` — 앱과 엔진 사이의 계약. 프로토콜을 바꾸면 이 문서와
  `RarsProbe.PROTOCOL` 을 같은 커밋에서 바꾸고, 버전 규칙(§9)을 따른다.
- `probe/src/RarsProbe.java` — RARS 를 라이브러리로 쓰는 stdio JSON 래퍼(엔진)
- `probe/src/DesktopExperiment.java` — `java.desktop` 없이 RARS 를 띄울 수 있는지 보는 실험
- `probe/client.py` — 프로토콜 클라이언트, `checks.py` — 기능 검사, `bench.py` — 측정
- RARS 는 `probe/setup.sh` 가 `$RARS_HOME`(기본 `~/.cache/hallym-riscv/rars`)에 받는다.
  저장소에 넣지 않는다. `.claude/hooks/session-start.sh`(SessionStart 훅)가 세션마다 이것을
  부르고 `RARS_HOME`·`RARS_JAR` 를 세션 환경에 넣는다. root 가 필요한 일(JDK 설치)은 하지 않는다.
- 래퍼의 fd 1 은 프로토콜 전용이다. RARS·JVM 이 쓰는 stdout/stderr 는 `System.setOut`
  으로 콘솔 이벤트로 돌려 놓았고, JVM 로그는 `-Xlog:all=warning:stderr` 로 보낸다.
  stdout 에 JSON 이 아닌 줄이 섞이면 client.py 가 크게 경고한다.

## 처음부터 지킬 규칙

- **추측하기 전에 재라.** "이게 문제일 것이다" 를 고치기 전에 숫자로 확인한다.
  MIPS 쪽에서 "Windows 에서 흐림 효과가 안 걸린다" 고 확신했다가 재보니 멀쩡했고,
  진짜 원인은 캡처 두 장이 1초 떨어져 찍혀 서로 다른 프레임을 비교한 것이었다.

- **보고에는 SHA 고정 링크를 붙여라.** 브랜치 이름이 아니라 커밋 해시로.

      https://raw.githubusercontent.com/<소유자>/<저장소>/<커밋해시>/<경로>

- **대기 루프에는 반드시** 상한, 매 폴링마다 경과 시간 출력, 상한에서 큰 소리로 실패,
  그리고 **루프에 들어가기 전에 대상 검증**(빈 값이면 즉시 실패).
  stderr 를 `2>/dev/null` 로 죽이지 마라. (MIPS 쪽에서 빈 run id 로 8시간 32분 폴링한 적이 있다.)

- **긴 실행은 CI 로 보내라.** 클라우드 세션은 백그라운드 프로세스가 세션 간에 안 남는다.
  로컬 실행은 짧게 유지한다. (`.github/workflows/ci.yml`)

- **검사를 통과하는 것과 검사가 의미 있는 것은 다르다.** 새 검사를 만들면 알려진 나쁜
  입력으로 실제로 실패하는지 확인하라. `checks.py` 의 모든 검사는 `must_fail` 음성 대조를
  갖는다. 대조가 통과하면 스크립트가 실패한다.

- **가져온 것은 고치지 않는다.** RARS 는 받은 그대로 둔다. 고쳐야만 되는 것이 나오면
  고치지 말고 보고한다(그 자체가 "포팅으로 가라" 는 신호다).
