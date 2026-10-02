작업 시작 전 `git checkout main`. 모든 작업과 커밋은 `main` 기준.
(기본 브랜치를 `main` 으로 바꾸는 것은 이 환경의 프록시가 막는다 — `gh api -X PATCH … default_branch=main` 이
"Repository settings writes are not permitted through this proxy" 로 거부됨. 저장소 설정에서 사람이 바꿀 때까지 이 줄이 대신한다.)

# CLAUDE.md

## 이 저장소

한림대 컴퓨터구조 수업용 RISC-V 시뮬레이터. 엔진은 RARS 를 JVM 째로 싣는다(②, `probe/REPORT.md`).
앱은 `electron/` — 한림 MIPS 시뮬레이터 v2.7.1 의 Electron 판을 같은 경로로 가져와 RISC-V 로 고친 것
(`electron/docs/FROM-MIPS.md` 가 무엇을 그대로, 무엇을 고쳐, 무엇을 빼고 가져왔는지의 목록).

- `docs/engine-protocol.md` — 앱과 엔진 사이의 계약. 프로토콜을 바꾸면 이 문서와
  `RarsProbe.PROTOCOL` 을 같은 커밋에서 바꾸고, 버전 규칙(§9)을 따른다.
- `probe/src/RarsProbe.java` — RARS 를 라이브러리로 쓰는 stdio JSON 래퍼(엔진)
- `probe/src/DesktopExperiment.java` — `java.desktop` 없이 RARS 를 띄울 수 있는지 보는 실험
- `probe/client.py` — 프로토콜 클라이언트, `checks.py` — 기능 검사, `bench.py` — 측정
- RARS 는 `probe/setup.sh` 가 `$RARS_HOME`(기본 `~/.cache/hallym-riscv/rars`)에 받는다.
  저장소에 넣지 않는다. `.claude/hooks/session-start.sh`(SessionStart 훅)가 세션마다 이것을
  부르고 `RARS_HOME`·`RARS_JAR` 를 세션 환경에 넣는다. root 가 필요한 일(JDK 설치)은 하지 않는다.
- `electron/src/sim/` — 엔진 경계(MIPS 판의 sim host 자리). `host.ts` 가 JVM 을 띄우고 죽으면 되살린다.
- 래퍼의 fd 1 은 프로토콜 전용이다. RARS·JVM 이 쓰는 stdout/stderr 는 `System.setOut`
  으로 콘솔 이벤트로 돌려 놓았고, JVM 로그는 `-Xlog:all=warning:stderr` 로 보낸다.
  stdout 에 JSON 이 아닌 줄이 섞이면 client.py 와 `transport.ts` 가 크게 경고한다.

## ⚠ fd 1 지뢰 — RARS 는 끝날 때 fd 1 을 닫는다

**RARS 와 같은 프로세스에서 fd 1 에 쓰려면 닫기를 무시하는 스트림을 끼운다.**

RARS 는 프로그램이 끝나면(`SystemIO.resetFiles`) `System.out` 을 `close()` 한다. 그 스트림이
`FileOutputStream(FileDescriptor.out)` 위에 있으면 **fd 1 자체가 닫히고**, 같은 fd 를 쓰는 다른
스트림(프로토콜 채널, 실험의 판정 줄)도 조용히 죽는다. 예외도 없다. 두 번 물렸다:
`RarsProbe` 에서 한 번(둘째 프로그램부터 출력이 사라짐), `DesktopExperiment` 에서 또 한 번
(판정 줄이 사라져 실험이 아무 말 없이 끝남). 막는 법: `System.setOut` 에 `close()` 를 무시하는
`PrintStream` 을 끼운다(`RarsProbe.NonClosingPrintStream`).

## JDK — 배포판과 버전을 고정한다

**Eclipse Temurin 21.0.12+1** (LTS). CI(`setup-java`, `distribution: temurin`, `java-version: '21.0.12'`)와
배포용 jlink 런타임은 이것으로 만든다. RARS 커밋을 고정한 것과 같은 이유다 — 같은 모듈 구성이라도
배포판마다 결과가 다르다: java.base+java.prefs+java.desktop 을 zip-9 로 jlink 하면 Temurin 21.0.12+1 에서
60.0 MB, Ubuntu OpenJDK 21.0.11 에서 55.8 MB(4.2 MB 차이, `probe/results/bench.json` 과 CI 로그).
개발 컨테이너의 Ubuntu OpenJDK 는 개발용일 뿐, 크기·동작 수치를 보고할 때는 Temurin 으로 잰 값을 쓴다.

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
  로컬 실행은 짧게 유지한다. (`.github/workflows/ci.yml` 탐침, `.github/workflows/electron.yml` 앱)

- **검사를 통과하는 것과 검사가 의미 있는 것은 다르다.** 새 검사를 만들면 알려진 나쁜
  입력으로 실제로 실패하는지 확인하라. `checks.py` 의 모든 검사는 `must_fail` 음성 대조를
  갖는다. 대조가 통과하면 스크립트가 실패한다. 대조는 앱이 스스로 흡수할 수 없는 결함이어야
  한다 — 제목 표시줄 검사에 "글자 넓히기" 를 대조로 넣었더니 앱이 단계를 밟아 맞춰 버려 대조가
  통과했다(`tests/e2e/titlebar.e2e.ts` 의 TITLEBAR_SABOTAGE 주석).

- **가져온 것은 고치지 않는다.** RARS 는 받은 그대로 둔다. 고쳐야만 되는 것이 나오면
  고치지 말고 보고한다(그 자체가 "포팅으로 가라" 는 신호다).

## Electron 판 배포 규칙 (한림 MIPS 판 CLAUDE.md 에서 가져옴)

아래 일곱 규칙은 MIPS 판(`ars2323/hallym-mips-simulator` v2.7.1)의 것을 그대로 옮겼다. 두 번 구부러지며
다듬어진 것이라 그대로 지킨다. 이름은 RISC-V 판에 맞게 읽는다(HallymMIPS → HallymRISCV, 2.x → 이 판의 버전).
RISC-V 판에 없는 것: Qt 판과 그 워크플로, 1.2.4 와의 나란히 설치, `CPU/`, 애드온(`electron/native`).
그 밖에는 지금 그대로 적용된다 —

- 검사표(규칙 3)는 `.github/workflows/electron.yml` 의 잡들이다: `linux`(타입, 단위, 문서 링크, 엔진 측정,
  RARS 대조, 모든 e2e), `widths`(네 폭과 1920), `windows`(설치본, `/S`, 설치된 앱의 e2e 와 1920, 한국어 IME,
  화면, 설치 관리자 페이지), `upgrade`(최신 릴리스 위에; 첫 릴리스 전에는 홀로, 그리고 자기 위에).
  엔진·탐침은 `.github/workflows/ci.yml`, 뮤턴트 전체는 `.github/workflows/mutants.yml`.
- 뮤턴트 기준선(`electron/tools/mutants-baseline.json`)은 `mutants.yml` 전체 패스가 초록일 때 그 산출물로
  사람이(또는 세션이) 커밋한다.
- 앱은 `electron/src` 와 엔진(`probe/src`)이다: 둘 중 하나를 바꾼 라운드는 배포로 끝난다.
- 규칙 4.2 의 설치 관리자 사진은 사람이 아니라 CI 가 커밋한다: `electron.yml` 을 main 에서
  `commit-pictures` 로 수동 실행하면 그 런의 `pictures` 잡이 Windows 사진(설치 관리자 넷, Windows 실물 둘)을
  `electron/docs/screens/` 에 커밋해 main 에 올린다. 세션은 CI 산출물을 내려받지 못한다(산출물이 놓이는
  `productionresultssa16.blob.core.windows.net` 을 세션의 네트워크 정책이 막는다). GITHUB_TOKEN 의 푸시는
  워크플로를 시작하지 않으므로, 그 커밋의 검사는 `electron.yml` 을 main 에서 한 번 더 수동 실행해 돌린다.
  뮤턴트 기준선은 `mutants.yml` 의 로그에 찍히는 JSON 을 옮겨 커밋한다.

### Releasing the Electron edition (MIPS 판 원문)

A change that has not reached the students has not been made. These rules hold for every round; they are not asked
for again each time.

1. **A round that changes the app ends with a release.** The app is `electron/src`, `electron/native` and `CPU/`.
   A round that changes only documents, tests or CI does not release: its report says "배포 없음" (no release) and why.
2. **The version is decided here, not asked for.** A change a student can see → minor (2.2.0); fixes only → patch
   (2.1.1). The report gives the reason.
3. **Release only when everything is green.** If one check is red, do not release: report it. The checks, reported
   as a table:
   - the Electron workflow green on the commit to be released; the Qt workflow green on the last commit that changed
     one of its inputs (`QtSpim/`, `tests/`, `Tests/`, `tools/`, `Setup/`, `CPU/`, SPIM's `README`, the guides
     `docs/GUIDE*.md` and `docs/images/`, `.github/workflows/ci.yml`: `git log -1 -- <those>`). It runs only when one
     of them changes (its `paths`); running it again on an unchanged Qt edition proves nothing. `CPU/` is shared: a
     change there runs both;
   - the unit tests (`cd electron && npm test`);
   - every e2e test at the four widths (`npm run e2e:widths`: 1280, 1093, 1024, 910), and **the whole suite once
     more with 1920×1040 as every test's window** (`SPIM_E2E_SIZE=1920x1040 npx playwright test`). "+1920" means that
     whole run, not only the 1920 checks inside `fit.e2e.ts`: a test that silently assumed a narrower window
     (`panels.e2e.ts`, found in the 2.4.0 round) showed up only there;
   - Korean input: the CDP tests (in the e2e) and the real Microsoft Korean IME (Windows CI);
   - settings reset to their defaults at every start (in the e2e);
   - mutants, against the baseline in `electron/tools/mutants-baseline.json` (a full pass that killed every mutant:
     its commit, date, the mutants it killed). **Every mutant this round could have touched is killed**
     (`node tools/mutants.ts --changed`): those whose `file`, or one of whose `tests`, changed since the baseline's
     commit (committed or not), and every mutant not in the baseline. The tool lists what it skipped and why,
     checks that none of those has a changed file, checks every mutant's `find` occurs exactly once in its `file`,
     and runs them all, saying why, when it cannot trust the change set. The full pass runs weekly in CI
     (`.github/workflows/mutants.yml`, results published as an artifact); when it is green, its baseline is
     committed by hand (CI does not write to the repository);
   - the Windows CI job's e2e against the installed app, the 1920 test included;
   - installing over 1.2.4 (side by side: Windows CI, every run) and over the latest published 2.x release (the
     workflow's `upgrade` job, in every run of a push to main; on a commit that still carries the released version
     it has nothing to upgrade from and says so instead, which a tag does not accept);
   - document links: 0 broken, 0 orphans (`node tools/check-doc-links.ts`);
   - greps: no old version given as the current one, no `[스크린샷 자리]`, no "하면 됩니다"-type ending (1.x documents
     excepted);
   - `slides/` unchanged (file count and combined hash).
4. **How to release.** The version bump (`electron/package.json`, `electron/package-lock.json`) and the release
   notes, `electron/docs/releases/<version>.md`, go in the commit that starts the release (rule 7). The notes are in
   English, for students: the Korean user guide's link first; what they will see that is different; that the
   program is unsigned and how to get past the Windows warning (link); links back to the previous 2.x release and
   to 1.2.4; no video links. Then:
   1. Push that commit and run the checks above. Its run (build, e2e, installer pages, upgrade) takes the installer's
      pictures (`report/installer/` in its `windows-report` artifact).
   2. Commit those pictures (`electron/docs/screens/installer-*`, `uninstaller-finish.png`) and push: the tag must
      carry the pictures of what it releases. That commit's own run checks it in turn.
   3. When that run is green, push the tag `v<version>` on that commit. The tag's workflow builds nothing: it takes
      the installer that commit's run built and checked (the run's commit must be the tag's, and its upgrade over
      the latest release must have run), publishes it as it is (not a pre-release; Latest; its SHA-256 added to the
      notes), and then runs the post-release check (`release-check.yml`). A failure anywhere opens an issue.
5. **It is released only when the post-release check has passed:** the installer downloaded from the public release
   address, its SHA-256 the one in the notes, installed on a clean runner, every e2e test run against it, every link
   and picture of the published documents opening, the release Latest, the earlier releases still there. Check its
   result and report it with the release's address and the hash. **Only the published asset's size and SHA-256 mean
   anything:** the installer is not byte-reproducible (NSIS writes the build time into it), so a build of the same
   commit elsewhere never matches it. In 2.4.0, main's build of the tagged commit was 109,639,153 bytes and the
   published one 109,639,124; that difference is not a bug to chase.
6. **Never delete an old release.** 1.2.4 is the Qt edition's last; the earlier 2.x releases are where to go back.
   The notes link back to them; rolling back is in `electron/docs/WINDOWS.md`, "Rolling back a release".
7. **The version is raised once, at the end of a round, in the commit that starts the release,** never in the middle
   of a round. The tag goes on a green descendant of it that changes no version: the installer pictures of rule 4,
   and fixes of what a check found there (both 2.3.0 and 2.4.0 met a Windows-only failure after the bump). Every
   check of rule 3 runs on the commit the tag goes on, and the report names both commits.

