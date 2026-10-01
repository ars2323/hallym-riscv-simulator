# RISC-V 1단계 보고: RARS 를 헤드리스로 구동할 수 있는가

결론부터: **②(탑재)를 권고한다.** RARS 소스를 한 줄도 고치지 않고 한 명령 밟기, 중단점,
Stop, 상태 읽기, 대화형 콘솔 입력, 반복 어셈블이 모두 된다. 래퍼는 376줄이고, stdio 로
한 명령 밟는 왕복은 중앙값 0.28 ms 다. 대가는 `java.desktop` 모듈이 꼭 필요하다는 것
(Linux x64 jlink 기준 +11.5 MB, zip-9 압축)과, 아래 "지저분한 곳" 네 군데를 래퍼가
우회해야 한다는 것이다.

## 고정한 것

| 무엇 | 값 |
|---|---|
| 탐침 코드 커밋 | `de087822b9ecdf889262f6060071c818e9d2aa96` |
| RARS 배포 jar | v1.6 `rars1_6.jar`, 1,860,244 B, sha256 `780f730eb457b1ba609e968accc2c8b77d8f92c3d9dbf30cc7fdb3cfb14e8c24` |
| RARS 소스 | 태그 v1.6 = 커밋 `7acf3254e84ab75fa612402b22fe915a2e00bdab` (2023-02-26), 서브모듈 jsoftfloat `75c3a5d1ab1322ce4dde0b5994d6f9f6ff820529` |
| 측정 환경 | Linux x86_64 클라우드 컨테이너, OpenJDK 21.0.11 (Ubuntu) |

재현 명령 한 줄:

    probe/setup.sh && probe/run.sh all

측정 원본: [bench.json](https://raw.githubusercontent.com/ars2323/hallym-riscv-simulator/de087822b9ecdf889262f6060071c818e9d2aa96/probe/results/bench.json),
[checks.json](https://raw.githubusercontent.com/ars2323/hallym-riscv-simulator/de087822b9ecdf889262f6060071c818e9d2aa96/probe/results/checks.json),
래퍼 [RarsProbe.java](https://raw.githubusercontent.com/ars2323/hallym-riscv-simulator/de087822b9ecdf889262f6060071c818e9d2aa96/probe/src/RarsProbe.java),
검사 [checks.py](https://raw.githubusercontent.com/ars2323/hallym-riscv-simulator/de087822b9ecdf889262f6060071c818e9d2aa96/probe/checks.py),
측정 [bench.py](https://raw.githubusercontent.com/ars2323/hallym-riscv-simulator/de087822b9ecdf889262f6060071c818e9d2aa96/probe/bench.py).

### 소스 빌드

- 빌드 체계: Maven/Gradle 이 아니라 **셸 스크립트 하나**(`build-jar.sh`: `find | xargs javac`
  → 리소스 복사 → `jar cfm`). 서브모듈(jsoftfloat)을 먼저 받아야 한다.
- **한 번에 된다.** `git submodule update --init && ./build-jar.sh` 로 JDK 21 에서 약 4.4 초,
  경고만 있고 오류 없음. 빌드 후 RARS 작업 트리의 소스 변경 없음(`git status` 에는 빌드 산출물만).
- 소스 빌드 jar 로도 `checks.py` 전 항목이 같은 결과로 통과했다.
- 주의: 배포 jar 는 **v1.6 소스와 같지 않다.** Java 8 바이트코드(52)이고, v1.6 소스에 없는
  파일이 들어 있다(`memory.properties`, `rars/tools/WrapLayout.class`, 익명 클래스 몇 개).
  깨끗하지 않은 작업 트리에서 빌드된 것으로 보인다. ②로 가면 고정 커밋에서 직접 빌드한
  jar 를 써야 재현 가능하다. 소스 빌드는 그 JDK 의 바이트코드 버전으로 나오므로(JDK 21 → 65),
  ②에서는 같은 단계를 우리 스크립트로 돌리면서 `--release` 를 고정해야 한다(RARS 는 수정하지 않음).
- RARS 상류의 마지막 커밋은 2023-08-09(`b0c5cd1`, v1.6 이후 3개). 사실상 정지 상태라 고정에는 유리하다.

## 3. 탐침 결과

판정은 모두 실제로 돌린 결과다(`checks.py`). 각 검사에는 음성 대조가 있어서, 알려진 나쁜
입력으로 그 검사가 실패하지 않으면 스크립트가 실패한다.

### 구동

| 질문 | 판정 | 근거 |
|---|---|---|
| GUI 없이 어셈블러·시뮬레이터 사용 | **된다** | `Globals.initialize()` → `RISCVprogram.assemble` → `Simulator.startSimulation`. 창·피어 클래스(JFrame, Window, X11) 로드 0개 |
| `-Djava.awt.headless=true` 만으로 되나, `java.desktop` 자체가 필요한가 | **`java.desktop` 필요** | java.base+java.prefs 로 jlink 한 런타임에서 `NoClassDefFoundError: java/awt/Color` (`Globals.initialize` → `Settings` → `SyntaxUtilities.getDefaultSyntaxStyles`). 헤드리스 플래그는 충분하다(디스플레이 없이 동작). 모듈을 빼는 건 RARS 수정 없이는 불가 |
| 어셈블 경로가 Swing/AWT 를 로드하나 | **로드한다(시작 시점), 어셈블 자체는 0개** | `-Xlog:class+load` 로 셈: 시작 시 java.desktop 클래스 13개(`java.awt.Color`, `Toolkit`, `GraphicsEnvironment`, `javax.swing.filechooser.FileFilter` 등), 어셈블이 추가로 로드한 것 0개, 첫 실행이 추가한 것 5개(`javax.sound.midi.*`, MIDI syscall 등록 때문) |

### 한 명령씩 밟기

| 질문 | 판정 | 근거 |
|---|---|---|
| 정확히 한 명령 실행 후 제어 반환 | **된다** | `startSimulation(pc, maxSteps=1, bps)` → `MAX_STEPS`. pc 0x400000→0x400004, `steps=1` |
| 반환 시점에 PC, x0–x31, 방금 실행한 명령의 주소·인코딩 | **된다** | 응답 하나에 `pc`, `x[32]`, `f[32]`, `executed{addr, code, basic, line, src}`. 예: `0x400000 0x0fc10517 auipc x10,0x0000fc10 line 5` |
| GUI 없이 중단점 걸기/풀기 | **된다** | `simulate` 의 `breakPoints` 인자. 0x400010 에서 `BREAKPOINT`, 빈 목록으로 풀고 다시 Run → `NORMAL_TERMINATION` |
| 실행 중 Stop | **된다(지저분함 1 참고)** | 무한 루프 Run 중 stop → 1.0 ms 안에 `reason:STOP`, 이후 step 재개 가능 |
| (덤) 한 단계 되돌리기 | **된다** | RARS 의 BackStepper 가 GUI 없이 동작. 3 step 후 backstep → 2번째 step 상태와 레지스터 일치 |

### 상태 읽기

| 질문 | 판정 | 근거 |
|---|---|---|
| x0–x31 + PC + f0–f31 한 번에, 비용 | **된다** | `regs` stdio 왕복 중앙값 0.08 ms, p99 0.36 ms (500회) |
| 임의 메모리 구간 | **된다** | 4096 B 읽기 왕복 중앙값 0.28 ms, p99 0.56 ms, 최악 3.5 ms (500회). 매핑 안 된 주소는 `address out of range 0x00000000` 로 실패 응답 |
| 텍스트 세그먼트 전체(주소·인코딩·디스어셈블·원본 줄) | **된다** | `getMachineList()` 의 `ProgramStatement` 마다 addr/code/basic/line/src. 의사명령 확장의 두 번째 줄은 `src` 가 빈 문자열(같은 원본 줄 번호) |

### 콘솔 입출력

| 질문 | 판정 | 근거 |
|---|---|---|
| 입력 스트림을 프로그램으로 바꿔 끼우기 | **된다(지저분함 3 참고)** | `System.setIn` 으로 래퍼의 스트림을 꽂고, 어셈블마다 `SystemIO.swapData(new SystemIO.Data(true))`. ReadInt 에 바깥에서 `21` 을 넣어 `42\n` 출력 확인 |
| 입력 대기 상태를 바깥에서 감지 | **된다** | 래퍼 스트림의 `read()` 가 빈 버퍼에서 막히기 직전에 `input_wanted` 이벤트를 보낸다. `status` 도 `waiting:true` |
| 입력이 없을 때 블록되나, 되돌릴 수 있나 | **블록된다 / 되돌릴 수 있다(지저분함)** | 시뮬레이터 스레드가 ecall 안에서 막힌다(프로토콜 스레드는 계속 응답). Step 이면 입력이 올 때까지 step 응답이 보류된다. 대기 중 Stop 하면 RARS 가 ecall 을 기본 입력 `"0"` 으로 **완료**해 버린다(a0 77→0, pc 는 ecall 다음). backstep 한 번이면 a0=77, pc=ecall 로 돌아오고 다음 step 이 다시 입력을 요구한다 |

### 오류

| 질문 | 판정 | 근거 |
|---|---|---|
| 어셈블 오류의 줄·열·메시지 구조화 | **된다** | `ErrorMessage.getLine/getPosition/getMessage/isWarning` |
| 여러 개 한 번에 | **된다** | `errors.s` → `L3:C9 "addi": Too few or incorrectly formatted operands…`, `L4:C14 "t9": operand is of incorrect type`, `L6:C9 "bogus" is not a recognized operator` |
| 실행 시간 오류 | **된다** | `reason:EXCEPTION cause:4 line:6 "Runtime exception at 0x00400008: Load address not aligned to word boundary 0x10010001"`. cause 는 RISC-V mcause 번호 |

### 여러 번 돌리기

| 질문 | 판정 | 근거 |
|---|---|---|
| 한 JVM 에서 어셈블→실행→다른 프로그램 어셈블, 깨끗한가 | **된다** | `dirty.s`(데이터 세그먼트에 표식, sbrk 4 KB)를 51번 돌린 뒤 `clean.s` 출력 `0 0 268697600` 이 새 JVM 의 출력과 같다. 이전 프로그램의 라벨도 보이지 않는다(`Symbol "buf" not found`) |
| `Globals` 등 정적 상태가 두 번째 실행을 오염시키나 | **메모리·레지스터·힙·심볼은 안 남는다. 콘솔 입력 버퍼는 남는다(래퍼가 처리)** | `SystemIO` 의 `inputReader` 가 정적이고 재어셈블 때 초기화되지 않아, 남은 입력 줄이 다음 실행으로 샌다. 래퍼가 어셈블마다 stdio 표를 갈아 끼워 해결. 음성 대조: 갈아 끼우기를 끈 탐침(`-Dprobe.skipStdioReset=true`)에서는 실제로 샌다 |

### 지저분한 곳 (모두 RARS 수정 없이 래퍼에서 우회됨)

1. **동기 `Simulator.simulate()` + Stop = NPE.** `stopExecution()` 이 `simulatorThread` 를 null 로
   만든 뒤 `simulate()` 가 `simulatorThread.pe` 를 읽는다(`NullPointerException: Cannot read field "pe"`).
   상태는 멀쩡하지만 응답이 예외로 끝난다. 래퍼는 GUI 와 같은 비동기 경로
   (`startSimulation` + `Simulator` 의 Observer 로 `SIMULATOR_STOP` 수신)를 쓴다. 그 결과 step
   마다 RARS 가 스레드를 하나 새로 만든다(측정값에 포함됨).
2. **프로그램이 끝나면 RARS 가 `System.out` 을 닫는다**(`SystemIO.resetFiles` → `outputWriter.close()`).
   그 뒤의 모든 프로그램 출력이 조용히 사라졌다. 래퍼는 닫기를 무시하는 PrintStream 을 꽂는다.
3. **정적 입력 리더가 실행 사이에 남는다**(위 "여러 번 돌리기").
4. **입력 대기 중 Stop 은 ecall 을 "0" 으로 완료시킨다**(위 "콘솔"). backstep 으로 되돌린다.

그 밖에 알아둘 것:

- RARS 는 프로세스 전체에 하나뿐인 정적 상태로 돈다. JVM 하나에 프로그램 하나. 앱에는 충분하다.
- `Settings` 가 `java.util.prefs` 로 사용자 홈(`~/.java/.userPrefs`)에 설정을 쓴다. 앱에서는
  `-Djava.util.prefs.userRoot=<앱 데이터 폴더>` 로 가둬야 한다.
- JVM 의 경고 로그 기본 출력이 stdout(=프로토콜 채널)이다. AppCDS 경고가 실제로 JSON 스트림을
  깨뜨렸다. 래퍼 실행 시 `-Xlog:disable -Xlog:all=warning:stderr` 를 붙인다.
- `input_wanted.pc` 는 이미 ecall 다음 주소다(RARS 가 실행 전에 PC 를 증가시킨다).

## 4. 측정

Linux x86_64, OpenJDK 21.0.11. 원본은 bench.json.

| 항목 | 값 |
|---|---|
| 콜드 스타트, 시스템 JDK: 실행→ready / 실행→첫 어셈블 응답 | 중앙값 178 ms / 197 ms (최악 212 / 236, 10회) |
| 콜드 스타트, jlink(java.base+prefs+desktop, 비압축) | 191 ms / 209 ms (최악 193 / 215) |
| 콜드 스타트, 같은 구성 zip-9 압축 | 217 ms / 238 ms (최악 230 / 253) |
| 콜드 스타트, 비압축 + AppCDS | 216 ms / 238 ms — 이득 없음 |
| stdio 왕복 한 명령 밟기 (1000회) | **중앙값 0.29 ms, p99 1.59 ms, 최악 8.0 ms** |
| 그중 첫 100회(JIT 전) | 중앙값 0.45 ms, 최악 3.2 ms |
| Run 처리량 (3,000,005 명령) | **1.48–1.52 M 명령/s**(back-stepper 켬), **2.04–2.05 M 명령/s**(끔) |
| "Instant": 5000 명령 Run 왕복 (50회) | 중앙값 3.1 ms, 최악 4.3 ms |
| 레지스터 전체 읽기 왕복 | 중앙값 0.08 ms |
| 메모리 4 KB 읽기 왕복 | 중앙값 0.28 ms, 최악 3.5 ms |
| jlink: java.base + java.prefs (java.desktop 없이, 실제로는 동작 안 함) | 64.6 MB / zip-9 **44.4 MB** |
| jlink: java.base + java.prefs + java.desktop (최소 동작 구성) | 85.7 MB / zip-9 **55.8 MB** |
| `java.desktop` 의 비용 | +21.1 MB(비압축) / **+11.5 MB(zip-9)** |
| RARS jar | 1,860,244 B (배포본), 1,875,496 B (v1.6 소스 빌드) |
| 래퍼 코드 | `RarsProbe.java` 376줄(빈 줄·주석 줄 빼면 335). JSON 파서 포함, 외부 의존 없음 |
| 시험 도구(래퍼 아님) | client.py 126, checks.py 350, bench.py 152 줄 |

jlink 크기는 Linux 에서만 쟀다. Windows 의 `java.desktop` 은 네이티브 DLL 이 달라 크기가 다를
수 있다 — 2단계에서 Windows 러너로 다시 잴 것.

## 5. 권고: ② 탑재

| 조건 | 결과 |
|---|---|
| RARS 수정 없이 동작 | 충족. 수정 0줄. 우회 4곳은 모두 공개 API 와 `System.setIn/setOut` 로 해결 |
| `java.desktop` 불필요, 또는 크기가 받아들일 만함 | 필요. 대신 +11.5 MB(zip-9), 전체 런타임 55.8 MB. 창 클래스는 하나도 안 뜬다 |
| 한 명령 밟기와 상태 읽기가 깔끔 | 충족. 한 응답에 pc·레지스터 64개·실행한 명령이 같이 온다 |
| stdin 바꿔 끼우기 | 충족(지저분함 3, 4 있음). 대기 감지 가능, 대기 중 Stop 은 backstep 으로 복구 |
| 한 JVM 반복 어셈블이 깨끗함 | 충족(51회 반복 후 새 JVM 과 출력 동일). 입력 리더만 래퍼가 초기화 |
| 래퍼가 작음 | 376줄 |
| 한 명령 지연이 사람이 못 느낄 수준 | 중앙값 0.29 ms, 최악 8.0 ms. 60 Hz 한 프레임(16.7 ms) 안 |

①로 가야 하는 신호는 하나도 나오지 않았다. 헤드리스에 RARS 수정이 필요하지 않았고, 스텝
제어는 GUI 이벤트 루프를 전제하지 않으며(Observer 콜백만), 정적 상태 오염은 입력 리더 하나뿐이고
공개 API 로 초기화된다. 래퍼가 흉내 내는 RARS 내부는 없다.

"1 line/s" 는 래퍼가 타이머로 step 을 보내면 되고, "Instant" 는 5000 명령이 3 ms, 300만 명령이
약 2초다. 콜드 스타트 0.2 초는 앱 기동 때 한 번이다.

②의 대가로 받아들여야 하는 것: 설치본에 런타임 약 56 MB(zip-9, Linux 기준), RARS 의 동기 Stop
버그를 피해 비동기 경로를 써야 한다는 제약, 그리고 상류가 2023년 이후 멈춰 있어 버그가 나오면
우리가 고칠 수 없다는 점(고치는 순간 "가져온 것은 고치지 않는다" 를 어기게 된다). 마지막 항목은
①의 비용(어셈블러·의사명령·지시어·syscall·오류 메시지 전체 재작성)에 비하면 작다고 본다.

## 6. 막힌 것

없음. 막힐 뻔한 것은 위의 "지저분한 곳" 네 가지와 JVM 로그의 stdout 오염이며, 모두 RARS 를
고치지 않고 래퍼 쪽에서 해결했다.

(정리 라운드에서 갱신) 설정은 이제 저장소 안에 있다. `.claude/settings.json` 의 SessionStart 훅이
`probe/setup.sh` 를 부른다. setup.sh 는 더 이상 apt 를 쓰지 않는다 — JDK 가 없으면 크게 실패한다.
RARS 는 `$RARS_HOME`(기본 `~/.cache/hallym-riscv/rars`)에 놓인다.

## 7. 정리 라운드 추가: `java.desktop` 은 피할 수 없다

RARS 를 고치지 않는다는 조건에서 확인했다. 실험은 `probe/src/DesktopExperiment.java`,
판정은 `checks.py` 의 `without java.desktop` 항목(음성 대조: 전체 JDK 에서는 같은 실험이 성공).

| 경로 | java.base+java.prefs 런타임 | 전체 JDK |
|---|---|---|
| `Globals.initialize()` (탐침이 쓰는 길) | 실패: `ClassNotFoundException: java.awt.Color` at `SyntaxUtilities.getDefaultSyntaxStyles:96` | 성공 |
| `rars.api.Program` | 실패: 같은 곳 (`new Program()` 이 `Globals.initialize()` 를 부른다) | 성공 |
| `Settings` 만 빼고 나머지 전역을 손으로 채움 | 실패: `InstructionSet.<clinit>:60` 에서 `Globals.getSettings()` 가 null | **실패(같은 이유)** |

- 어셈블·실행 경로는 `Settings` 를 **반드시** 초기화해야 한다. `InstructionSet` 의 정적 초기화가
  설정을 읽고, 핵심 클래스에 `Globals.getSettings()` 호출 지점이 31곳 있다(Memory 10, RegisterFile 3,
  Simulator 3, Program 3, 그 밖). `Globals.settings` 는 패키지 전용 필드라 다른 객체를 끼울 수도 없다.
- `Settings` 의 생성자는 무조건 `initializeEditorSyntaxStyles()` → `SyntaxUtilities.getDefaultSyntaxStyles()`
  를 불러 `new java.awt.Color(...)` 를 만든다. 조건 분기가 없다.
- `java/awt/Color` 를 참조하는 클래스는 jar 전체에 67개, 그중 GUI(`venus`, `tools`) 밖은
  `Settings` 와 그 내부 클래스 3개(`ColorProviderMix`, `ColorSettingMix`, `LookAndFeelColor`)다.
  바이트코드 참조 지점은 `Settings` 30, `SyntaxUtilities` 33, `SyntaxStyle` 11.
- 설령 `Settings` 를 피해도 두 번째 끌어옴이 있다: 첫 `ecall` 에서 `SyscallLoader` 가 모든 syscall 을
  만들면서 `javax.sound.midi.*`(역시 java.desktop) 5개를 로드한다(MIDI syscall). GUI 밖에서 java.desktop
  을 참조하는 syscall 클래스가 12개(`SyscallInputDialog*`, `SyscallMessageDialog*`, `Tone` 등)다.

**결론: 피할 수 없다. zip-9 기준 55.8 MB 를 받아들인다.**
