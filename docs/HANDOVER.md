# 인계: hallym-riscv-simulator → assembly-studio

2026-10-04. 이 저장소의 개발은 여기서 멈춘다. 1.0.0 은 발행하지 않았다(태그·릴리스 없음).
앞으로의 작업은 새 저장소 **assembly-studio** 에서 하고, 그쪽이 이 저장소에서 엔진과 RISC-V 관련 코드를 가져간다.
이 문서는 무엇이 어떤 상태로 있는지, 무엇이 확인됐고 무엇이 확인되지 않았는지를 적는다.

## (가) 기준 커밋과 브랜치

- 저장소 `ars2323/hallym-riscv-simulator`, 브랜치 **`main`**.
- 코드 기준 커밋: **`a80f4bc663aef9771a91c86ba767ef62199dcbad`** (2026-10-04, "Gate fixes: …").
  이 문서와 README 첫 줄은 그 위의 문서 전용 커밋 하나에 들어 있다(코드 변경 없음). 가져갈 때는 `main` 의
  끝(그 문서 커밋)을 써도 코드는 a80f4bc 와 같다.
- `electron/package.json` 의 버전은 `1.0.0` 이지만 **1.0.0 은 발행되지 않았다.** 버전 번호는 손대지 않고 두었다.
- a80f4bc 의 CI 상태(마지막으로 본 것):
  - `ci.yml`(엔진·탐침): 초록.
  - `electron.yml` push 실행 37169547650: **Windows job 만 빨강**, 나머지(Linux, 네 폭+1920, 프레임 비용 단독,
    영상) 초록. 빨강 원인: `tests/e2e/settings.e2e.ts` "killed outright" (아래 (마) 참고).
  - `electron.yml` dispatch(commit-pictures) 37169550282: 빨강(원인은 보지 않았다), 사진 커밋은 만들어지지 않았다.
  - `mutants.yml`: a80f4bc 에서는 돌지 않았다. 마지막 전체 패스는 4faba4d(실행 37166890069, 뮤턴트 195개, 6개 부분):
    control 통과, 생존 1
    ("the card lit although motion is turned down") — a80f4bc 에서 검사를 고쳐 로컬에서 죽였다(CI 미확인).
    `electron/tools/mutants-baseline.json` 은 이번 라운드에 갱신하지 않았다.

## (나) 엔진 — assembly-studio 가 통째로 가져갈 부분

### probe/ (RARS 래퍼)

| 파일 | 무엇 |
|---|---|
| `probe/src/RarsProbe.java` | RARS 를 라이브러리로 쓰는 stdio JSON 래퍼. 프로토콜 버전 `PROTOCOL = 2` |
| `probe/src/HallymPrefs.java` | `java.util.prefs.PreferencesFactory` 구현 — RARS 설정을 엔진 자기 폴더에만 둔다 ((다) 참고) |
| `probe/src/DesktopExperiment.java` | `java.desktop` 없이 RARS 를 띄울 수 있는지 본 실험. 앱에는 들어가지 않는다 |
| `probe/setup.sh` | RARS 를 `$RARS_HOME`(기본 `~/.cache/hallym-riscv/rars`)에 받고 소스에서 빌드. root 불필요 |
| `probe/run.sh` | 래퍼 빌드(`javac --release 11`)·실행 |
| `probe/client.py`, `checks.py`, `bench.py` | 프로토콜 클라이언트, 기능 검사(모두 `must_fail` 음성 대조 포함), 측정 |
| `probe/REPORT.md` | 왜 RARS 를 JVM 째로 싣는가(②안), 소스 빌드를 쓰는 이유 |
| `probe/results/` | 측정 결과(`bench.json` 등) |

- **RARS 원본은 한 줄도 고치지 않았다.** 래퍼는 RARS 의 공개 API 만 부르고, 설정·입출력은 JVM 속성과
  `System.setOut/setErr`, `PreferencesFactory` 로만 바꾼다.
- fd 1 지뢰: RARS 는 프로그램이 끝날 때(`SystemIO.resetFiles`) `System.out` 을 `close()` 한다.
  `RarsProbe.NonClosingPrintStream` 이 막는다. 이걸 빼면 둘째 프로그램부터 프로토콜 채널이 조용히 죽는다.

### RARS 고정값

- 소스: `TheThirdOne/rars` 태그 **v1.6**, 커밋 **`7acf3254e84ab75fa612402b22fe915a2e00bdab`** (+ jsoftfloat 서브모듈).
- **릴리스 jar(`rars1_6.jar`)는 쓰지 않는다.** 그 jar 는 v1.6 소스와 같지 않다(`probe/REPORT.md` "소스 빌드").
  앱이 실행하고 배포하는 것은 위 커밋에서 RARS 자신의 `build-jar.sh` 로 빌드한 `rars-src.jar`
  (`JDK_JAVAC_OPTIONS=--release 11`, 스크립트는 고치지 않음). `rars1_6.jar` 는 sha256 확인 뒤 탐침의 비교용으로만 받는다.

### JDK 와 jlink

- **Eclipse Temurin 21.0.12+1** 고정 (CI `setup-java` temurin `21.0.12`, 배포 런타임도 이것).
- jlink 모듈: **`java.base`, `java.prefs`, `java.desktop`** (java.desktop 이 끌고 오는 `java.datatransfer`, `java.xml`
  포함), zip-9, 디버그 정보 없음. Temurin 21.0.12+1 에서 46.2 MB (풀었을 때, `electron/docs/WINDOWS.md` 표).
- jdeps 검사: `electron/tools/check-java-modules.ts` (`tools/java-modules.ts` 의 목록과 엔진 클래스의 jdeps 결과를 비교,
  음성 대조로 `java.util.logging` 클래스를 넣으면 실패). a80f4bc 의 Linux CI 에서 통과.
  `HallymPrefs` 를 넣은 뒤에도 통과(`java.prefs` 는 이미 목록에 있었다).

### 엔진이 끝나는 세 경로 (Windows 고아 JVM)

엔진은 둘이다(실행용 `main`, 입력 중 검사용 `checker`): RARS 가 기계를 static 필드에 두므로 JVM 하나에 RARS 하나.
둘 다 메인 프로세스의 직접 자식인 `java.exe` 다(셸·`.bat`·런처 없음, `tests/sim/process.test.ts` 가 고정).

1. **부모 감시** — `-Dparent.pid`, `ProcessHandle.onExit`(java.base), 끝날 때 `Runtime.halt`(종료 훅이 막지 못한다).
2. **stdin EOF** — 메인이 죽으면 파이프가 닫힌다. Windows 에서도 실제로 온다(측정).
3. **libuv job object** — `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. 보장은 아니다: detached 자식, 손자, 이미 다른 job 에
   들어 있는 앱(실습실 관리 에이전트)에서는 빠진다.

**결론: Windows 고아 JVM 은 관측된 적이 없었다 — 문제는 존재하지 않았다.** 근거(`electron/docs/WINDOWS.md`,
CI 5a90f3c, 설치본): 651cf16 의 "고아" 는 Playwright 가 설치본을 `cmd.exe /d /s /c "...HallymRISCV.exe"` 로 띄운 탓에
테스트가 `cmd.exe` 를 죽인 것이었다(앱은 엔진과 함께 계속 돌고 있었다). 올바른 프로세스를 `taskkill /F` 했을 때
세 경로 각각 단독으로 0개 남음(250–262 ms). **셋을 모두 끈 대조군에서만 고아 2개가 재현된다.** 학생이 띄우는 경로
(설치 관리자의 "지금 실행하기")에서도 0개, 272 ms. 부모 감시는 job object 의 조건에 기대지 않는 유일한 길이라 남겨 두었다.

### stderr 라우팅

- 래퍼의 fd 1 은 프로토콜 전용이다. RARS·JVM 의 stdout 은 `System.setOut` 으로 콘솔 이벤트로 돌린다.
- `System.err` 는 `RarsProbe.ErrRouter` 가 스레드로 가른다: RARS 시뮬레이터 스레드(`"RISCV"`)가 쓰는 것 =
  **학생 프로그램의 fd 2 → Console 의 `err` 이벤트**. 그 밖(java.util.logging, 라이브러리 경고, 스택 트레이스) =
  진짜 fd 2 → 앱이 **실행 폴더의 `engine-<role>.log` 파일**에 쓰고 화면에 보이지 않는다
  (`electron/src/sim/transport.ts` `logFile`). JVM 로그는 `-Xlog:disable -Xlog:all=warning:stderr` 로 같은 곳.
- stdout 에 JSON 아닌 줄이 섞이면 `client.py` 와 `transport.ts` 가 크게 경고한다.

### electron/src/sim/ 와 docs/engine-protocol.md

- `sim/transport.ts` — JVM 인자(`engineArgs`), spawn 옵션(`windowsHide`, `detached`), 줄 단위 JSON 전송, 로그 파일.
- `sim/host.ts` — 엔진을 띄우고 죽으면 되살린다(`restartOnCrash`), 상태(starting/ready/restarting/dead)를 창에 알린다.
- `sim/protocol.ts` — 메시지 타입.
- `docs/engine-protocol.md` — **프로토콜 버전 2**. 바꿀 때는 이 문서와 `RarsProbe.PROTOCOL` 을 같은 커밋에서 바꾸고
  §9 의 규칙을 따른다. 알려진 구멍(§10): 레지스터·메모리 쓰기 없음, CSR 읽기 없음, 어셈블 옵션 없음(RARS 기본값 고정),
  파일 하나뿐, 출력 홍수 대비 없음, 진행 중 읽기 불가, Pause 없음, 진행 이벤트 없음.

### RARS 가 실제로 지원하는 범위

`rars-src.jar` 의 `rars/riscv/instructions/` 클래스 149개로 확인(2026-10-04):

- **I, M, F, D, Zicsr, N**(사용자 수준 인터럽트: `URET`, `ustatus`/`ucause`/`uepc`), `WFI`.
- **A 는 없다** — `LR`/`SC`/`AMO*` 클래스 0개.
- **RV64 도 가능** — `ADDIW`, `MULW`, `DIVW`, `FCVT.*.L` 등 W·L 명령과 `PseudoOps-64.txt` 가 있다. RARS 설정으로
  64비트를 켜야 한다. 이 엔진은 그 설정을 건드리지 않으므로 지금은 RARS 기본값인 32비트다.
- **ISA 표기 오류:** 앱과 문서는 이 엔진을 사실상 RV32I 로 다룬다. 시작 화면의 die 표기 `RV32I` 는 MIPS 2.8.0 이식 때
  화면에서 빠졌지만(지금은 `tools/mutants.ts` 의 뮤턴트 문자열에만 남아 있다), `electron/src/core/explain.ts` 주석은
  "RV32I and the M and F instructions" 라 하고, 인스펙터 문구는 "RV32 명령 형식" 이다. **실제로 실행되는 것은 RV32IMFD
  (+Zicsr, N)이다.** assembly-studio 에서 ISA 를 표기한다면 RV32IMFD 기준으로 써야 한다.

### FP 가 UI 에 열려 있는 정도 (아는 대로)

- **레지스터:** f0–f31 을 Registers 패널에 접힌 그룹("Floating point")으로 보여 준다(ABI 이름 ft/fs/fa 와 함께,
  64비트 값). `fcsr` 표시 여부는 확인하지 않았다.
- **엔진:** `regs` 응답에 `f[]`(RARS 의 단정도 보기, NaN-boxing 아니면 NaN)와 `fbits`(64비트 원값)가 있다.
- **인스펙터·디코더:** `electron/src/core/decoder.ts` 는 opcode 0x43/0x47/0x4b/0x4f(fmadd/fmsub/fnmsub/fnmadd)를
  **R4 형식으로 인식은 하지만 필드로 분해하지 않는다**(rs3 를 그리지 않는다). 인스펙터는 그림 대신 그렇다고 말한다.
  OP-FP(0x53)는 R, LOAD-FP/STORE-FP 는 I/S 로 분해한다.
- 편집기 키워드 표(`core/op-table.ts`)에는 `fmadd.s`, `fmadd.d` 등 FP 명령이 RARS 소스에서 뽑혀 들어 있다.

## (다) Windows 레지스트리 수정

**문제:** RARS 는 설정을 `java.util.prefs` 로 저장하고, Windows 에서 그 기본 구현은 레지스트리
`HKCU\Software\JavaSoft\Prefs\rars` 에 쓴다(시작할 때마다). 계정 하나를 여럿이 쓰는 실습실에서 앞 학생의 RARS
설정이 다음 학생에게 남는다. `-Djava.util.prefs.userRoot` 는 Linux/macOS 만 읽는다.

**한 것:**
- `probe/src/HallymPrefs.java` — `PreferencesFactory` 구현. 설정을 `java.util.prefs.userRoot` 폴더 아래 노드별
  `prefs.properties` 로 둔다(flush 때만 쓴다). RARS 는 고치지 않았다.
- `-Djava.util.prefs.PreferencesFactory=HallymPrefs` 를 모든 플랫폼에서 넘긴다(`sim/transport.ts` `engineArgs`).
- 폴더 위치: 엔진마다 다른 폴더, **OS 임시 폴더 아래 실행 폴더 안** —
  `%TEMP%\HallymRISCV\run-<pid>-<time>\rars-prefs-main`, `…\rars-prefs-checker`.
- 정상 종료: 앱이 끝난 뒤 분리된 Node 프로세스가 실행 폴더를 지운다(`src/main/main.ts`, `app.on('quit')`).
- 강제 종료(작업 관리자): 다음 시작 때 `run-<pid>-*` 중 그 pid 가 살아 있지 않은 폴더를 지운다(`main.ts` 앞부분).

**정방향 검사 — 통과 (Windows CI, 4faba4d 와 a80f4bc 둘 다):** `tests/e2e/registry.e2e.ts` 가 실행 전후
`HKCU\Software\JavaSoft\Prefs` 아래 모든 키·값을 비교 — "before: 0; new after a run: 0".
Linux: `tests/sim/process.test.ts` 항목 8 (홈 폴더에도, JDK 백엔드에도 흔적 없음) 통과.

**음성 대조 — 성립 (Windows CI, 4faba4d·a80f4bc):** 같은 실행을 JDK 자신의 `WindowsPreferencesFactory` 로 돌리면
`new under HKCU:\Software\JavaSoft\Prefs with the JDK's factory: 1: key HKEY_CURRENT_USER\Software\JavaSoft\Prefs\rars`
— 키가 실제로 생긴다. (fdc3609 에서는 대조군이 돌기 전에 죽었다: `Remove-Item` 이 없는 키에서
`-ErrorAction SilentlyContinue` 로도 종료 코드 1 을 냈다. 4faba4d 에서 고쳤다.) Linux 대조(JDK 파일 백엔드는 폴더를 남긴다)도 통과.
뮤턴트 "RARS's settings back in the JDK's backend" — 죽는다.

**강제 종료 후 청소 — Linux 에서만 확인, Windows 미확인:** `settings.e2e.ts` "killed outright" 는 Linux 에서 통과하고
뮤턴트("the folders of killed runs left to pile up")도 죽는다. **Windows CI 에서는 실패했다**(4faba4d: 엔진이 10초 안에
안 끝남, a80f4bc: "the killed run's folder is still there"). 원인은 조사하지 않았다. 유력한 후보: Playwright 가 설치본을
`cmd.exe` 를 거쳐 띄우므로 테스트가 `app.process()` 로 죽인 것이 앱이 아니라 `cmd.exe` 였을 가능성 — 651cf16 과 같은 실수
(위 (나)). 그렇다면 앱이 살아 있으니 폴더가 남는 것이 맞다. 확인되지 않았다.

## (라) 시작 화면 이식 (MIPS 2.8.0 → 2.8.1)

**가져온 것** (MIPS `v2.8.0` 35be23de, 그 위 `v2.8.1` f54b577 의 변경 포함):

| 파일 | MIPS 와 바이트 동일? |
|---|---|
| `electron/src/renderer/startfield/generate.ts`, `render.ts`, `index.ts`, `glints.css`, `css.d.ts` | **동일** (2.8.0 = 2.8.1, sha256 비교) |
| `electron/src/renderer/app/panels/spark.ts` | `SEED` 한 줄만 다름 |
| `electron/tests/renderer/spark.test.ts`, `tests/e2e/board-measure.ts`, `tests/e2e/png.ts` | 동일 |
| `electron/tools/start-cost.ts`, `start-film.ts`, `start-measure.ts` | 동일 |
| `electron/tests/renderer/startfield.test.ts` | 시드를 `spark.ts` 에서 읽고, 개수·골든을 이 시드로 다시 잡음 |
| `electron/src/renderer/app/panels/welcome.ts` | MIPS 2.8.0 전체 + 워드마크 + 잉크 중앙 정렬(아래) |
| `electron/src/renderer/app/app.css` | 2.8.0/2.8.1 의 `.wtitle`, `.action`, 카드·스택, 2.8.1 의 첫 화면 위쪽 띠 비우기 + `.wstack` transform 한 줄 |
| `tests/e2e/start.e2e.ts`, `editor.e2e.ts`, `flows.e2e.ts`, `settings.e2e.ts`, `window.e2e.ts` | MIPS 2.8.1 의 것을 바탕으로 이름·시드·추가 검사만 바꿈 |

전체 대조표는 `electron/docs/FROM-MIPS.md` (MIPS v2.8.1 기준으로 생성, `tools/from-mips.py`).

**바꾼 것 셋 (그 밖의 startfield 파라미터는 하나도 안 바꿈):**
1. `panels/spark.ts` `SEED = 20261003` (MIPS 20261002).
2. `panels/welcome.ts` `WORDMARK = 'Hallym RISC-V Simulator'`.
3. 심볼 경로: `hallym/marks/symbol-basic.svg` — 이 저장소의 같은 파일(경로 동일).

**카드 잉크 세로 중앙 정렬 (이 저장소에서 고친 것):**
- 원인: 열(`.wstack`)은 상자 기준으로 가운데 정렬되는데, 첫 단계에서 숨은 "← 처음으로"(`visibility: hidden`,
  14+18 px)가 상자에 들어 있어 잉크가 16 px 위로 쏠렸다. 1920×1080 에서 위 72.25 / 아래 103.5 px, **1.43 : 1**
  (MIPS 2.8.0 도 1.42). 심볼 SVG 자체의 투명 여백은 0.75/0.5 px 로 원인이 아니다.
- 고침: `welcome.ts` `centre()` 가 심볼(알파로 잰 잉크)·제목·두 버튼의 위아래를 재고, 그 가운데가 die 프레임 가운데에
  오도록 `--ink-shift` 를 준다(`.wstack { transform: translateY(var(--ink-shift, 0px)); }`). 크기 변화와 글꼴 로드 때 다시 잰다.
- **규칙 — 반드시 같이 가져갈 것: 고정 요소(심볼·제목·버튼)로만 재고, 단계 전환에서 재측정하지 않는다.**
  "← 처음으로" 를 보일 때 잉크에 넣으면 2단계(바로 시작 → 새 파일/파일 열기)에서 버튼이 **15 px 위로 튄다**
  (CI fdc3609, `editor.e2e.ts` "the first screen keeps its shape from one step to the other"). 단계 전환 때 다시 재기만 해도
  반올림으로 **1 px** 튄다. 두 단계의 고정 요소는 같으므로 1단계의 이동이 2단계의 이동이다.
- 측정(die 프레임 안, 위/아래): 1280×800 61/62 px **0.984**, 1920×1080 84/83 **1.012**, 1920×540 34/33 **1.030**,
  1024×768 52/54 **0.963** — 검사 기준 1.00 ± 0.08. 뮤턴트("the column centred by its boxes") 죽음.

**보드 측정값** (1920×1080, `tools/start-measure.ts`, Linux xvfb, MIPS 와 같은 목표):

| | 목표 | MIPS 2.8.0 | 이 저장소 |
|---|---|---|---|
| 평균 밝기 | 38–56 | 51.5 | **51.2** |
| 0–20 | ≤ 30 % | 0.00 % | 0.00 % |
| ≥ 45 | 22–34 % | 26.67 % | 27.41 % |
| ≥ 160 | 4–9 % | 4.85 % | 4.76 % |
| ≥ 220 | 1.5–4.5 % | 1.61 % | 1.61 % |
| 최초 점등 p10 / p50 / p90 / p99 | 0.6–1.0 / 2.2–3.0 / 5.0–6.5 / 7.5–9.0 s | 1.97 / 3.77 / 6.55 / 8.32 | **0.90 / 2.85 / 5.85 / 7.50 s** |
| p90 − p10 | ≥ 4.0 s | | 4.95 s |
| 고리 90 % 시차(가장 먼 − 가장 가까운) | ≥ 2.0 s | 약 5.1 s | **5.70 s** (1.80 / 3.00 / 4.65 / 6.30 / 7.50) |
| 다 자란 시각 | | | 8.32 s |
| 선 밀도 | 11–15 /1000 px | | 10.95 — **범위 밖**, MIPS 검사도 보고만 하고 강제하지 않음. 파라미터는 안 바꿈 |

생성기(1280×800): 트레이스 227, 길이 27,485 px, 패드 474(떠 있는 것 228), 골든 `aae3aa7e51501277`.
1920×1080 은 트레이스 399 — 면적 2.03배에 1.76배(0.87, 허용 0.75–1.25).
영상: 1920×1080, 14 s, 60 fps, 840 프레임을 두 번 찍어 모두 동일(CI `film` job, 로컬도 동일).

## (마) 미검증·BLOCKED — "통과했지만 증명되지 않은" 것 포함

1. **콘솔 창 검사 — 대조군 BLOCKED.** `tools/windows/console-flash.ps1`: 출고 상태에서 콘솔 창이 안 뜬다(PASS).
   그러나 `windowsHide` 를 끈 대조군에서도 CI 러너에는 창이 뜨지 않는다 — 이 러너에서는 검사가 아무것도 증명하지
   못한다. `windowsHide` 는 단위 검사(`tests/sim/process.test.ts`)와 뮤턴트("java started without windowsHide")로만 고정돼 있다.
2. **프레임 비용 — 꼬리 허용치가 표본 대비 빠듯하다.** `tests/e2e/frame-cost.e2e.ts`(전용 CI job "Frame cost, alone",
   Windows 에서는 설치본 대상 단독 단계): 처음 1.5 s 제외, 중앙값 게이트(성장 8 ms, 정착 5 ms), 예산 초과 프레임
   (16 / 12 ms) 1 % 이하. CI 에서 초록이지만, 바쁜 컨테이너에서 정착 구간 226 프레임 중 2개 초과 대 허용 2개.
   벽시계로 재므로 스레드가 CPU 에서 내려간 시간이 섞인다(측정 오염, 매번 다른 프레임 20–68 ms).
3. **`start-1093.webp` / `start-2-1093.webp` 가 다시 찍을 때마다 바뀐다.** 1.25배에서 같은 순간의 원본 PNG 두 장이
   997,272 픽셀 중 150–185 픽셀에서 1 단계 다르고(래스터라이저), 손실 WebP 가 그것을 그림 전체의 최대 18 단계 차이로
   키워 "바뀌지 않음" 규칙(2 단계 넘는 픽셀 20개 이하)을 넘긴다. `electron/docs/screens/README.md` 에 기록.
4. **강제 종료 후 폴더 청소 — Windows 에서 실패, 원인 미조사** ((다) 참고).
5. **강제 종료 후 엔진 종료 — 이 테스트 안에서 Windows 에서 10 s 넘게 살아 있었다** (4faba4d). (나)의 결론
   (올바른 프로세스를 죽이면 250 ms)과 어긋나 보이지만, 위와 같은 `cmd.exe` 문제일 가능성이 크다. 확인 안 됨.
6. **installer-started 사진이 아직 옛 캠퍼스 시작 화면이다.** `electron/docs/screens/installer-started.webp` 는 이전
   CI 의 PNG 를 변환한 것. commit-pictures 실행이 Windows 실패로 막혀 새 회로기판 화면으로 교체되지 않았다.
   문서는 캠퍼스 영상을 제거했다고 쓰므로, 이 한 장은 문서와 어긋난다.
7. **전체 뮤턴트가 최종 트리(a80f4bc)에서 돌지 않았다.** 4faba4d 의 생존자 1개는 a80f4bc 에서 로컬로만 죽였다.
8. **프레임 비용 등 일부 수치는 개발 컨테이너(Ubuntu OpenJDK, 4코어, 부하 있음)에서 잰 것** — CLAUDE.md 는 보고 수치를
   Temurin 으로 재라고 한다. 보드 밝기·타이밍은 가상 시계라 기계와 무관하지만, 프레임 비용 로컬 수치는 참고용이다.
9. **설치본 크기 1.0.0 수치가 WINDOWS.md 에 반영되지 않았다** — 표는 0.1.0(2026-10-02, 140,534,430 바이트) 그대로.
10. **WINDOWS.md 마지막 문단("RARS's own settings: on Windows … registry")** 은 HallymPrefs 이전 서술이 남은 것이다.
    위 (다)가 현재 상태다.
11. **한국어 실제 IME** 단계는 CI 에서 건너뛰어졌다(러너에 IME 가 없을 때 그렇게 보고하는 구조). CDP 검사는 통과.
12. **MIPS 로 역이식할 목록**(MIPS 2.8.2 용, `electron/docs/PORTING.md` §33): 잉크 중앙 정렬(위 규칙 포함),
    워크플로의 `set -o pipefail`, WebP 사진과 400 KB 상한 검사, 최소화/복귀 이중 페인트 검사, ResizeObserver 해제 검사,
    축소 모션 검사의 시드 맹점. 하나도 MIPS 로 옮기지 않았다.

## (바) 태그 403 과 기본 브랜치

- **이 환경에서 git 태그 푸시는 프록시가 HTTP 403 으로 거부한다**(지난 라운드에 확인). 이번 라운드에는 태그를
  시도하지 않았다. REST `POST /repos/…/git/refs` 도 시도하지 않았다.
- **기본 브랜치가 아직 `claude/epic-allen-eeuhic` 다.** 모든 작업은 `main` 에 있다. 저장소 설정 변경
  (`PATCH … default_branch=main`)은 이 환경의 프록시가 "Repository settings writes are not permitted through this proxy" 로
  막는다. 사람이 Settings → General 에서 바꿔야 한다. 저장소 설명(description)도 비어 있다.
- 릴리스는 하나도 없다.

## (사) assembly-studio 가 가져가면 안 되는 것

- **RARS 자체**(jar, 소스) — 저장소에 넣지 않는다. `probe/setup.sh` 처럼 고정 커밋에서 받아 빌드한다.
- **`rars1_6.jar`(릴리스 jar)** — v1.6 소스와 다르다. 비교용일 뿐.
- **한림대 표장·캐릭터** — `electron/src/renderer/assets/hallym/`, `electron/packaging/icons/`, 설치 관리자 측면 띠
  (`electron/packaging/*.bmp`). 이 저장소의 어떤 라이선스로도 허락되지 않았다(NOTICE §7). 대학의 허락 없이 다른
  프로젝트로 가져가지 않는다.
- **RISC-V·MIPS 로고** — 넣지 않았고, 넣지 않는다. ISA 는 글로만. "RISC-V is a registered trademark of RISC-V
  International …" 문구는 NOTICE 에 있다.
- **MIPS 판에서 그대로 온 문서**(`electron/docs/PORTING.md` §1–32, `ARCHITECTURE.md` 의 SPIM·.hmx·애드온 서술,
  `UI-ROUND1.md`) — MIPS 판의 역사이지 이 엔진의 사실이 아니다.
- **`probe/src/DesktopExperiment.java`, `probe/__pycache__`, `probe/build`, `probe/results` 의 측정 산출물** — 실험·산출물.
- **`electron/docs/screens/`, `docs/usage/images/` 의 사진** — 이 앱의 화면이다. installer-started 는 옛 화면이다((마) 6).
- **옛 시작 화면의 흔적** — 이미 지웠다(`panels/backdrop.ts`, `assets/hallym/start/`, `tools/start-video.ts`,
  `start-variants*`, `backdrop-measure.ts`, `clip-motion.ts`, `start-clip.test.ts`). 되살리지 않는다.
- **이 저장소의 버전 번호 1.0.0** — 발행되지 않은 번호다. assembly-studio 의 버전과 이어 붙이지 않는다.
- **`electron/tools/mutants-baseline.json`** — 4faba4d 이전 기준이고 이번 라운드에 갱신되지 않았다.
