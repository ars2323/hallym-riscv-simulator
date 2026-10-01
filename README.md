# Hallym RISC-V Simulator

한림대학교 컴퓨터구조 수업용 RISC-V 시뮬레이터(Hallym MIPS Simulator 의 RISC-V 판)를
만들기 위한 저장소다. **지금은 1단계: 앱이 없다.** RARS(Java)를 수정 없이 JVM 째로
싣고 stdio JSON 으로 구동하는 길(②)이 성립하는지만 재는 탐침(`probe/`)과 그 측정값,
결정을 담고 있다. 결과는 [`probe/REPORT.md`](probe/REPORT.md), 탐침 결과로 ②(RARS 탑재)가
확정됐다. 앱과 엔진 사이의 계약은 [`docs/engine-protocol.md`](docs/engine-protocol.md).

    probe/setup.sh         # RARS v1.6 jar + 소스(고정 커밋) 받기·빌드 (root 불필요, 멱등)
    probe/run.sh all       # 래퍼 빌드 → 측정(bench.py) → 검사(checks.py)

Claude Code 세션에서는 `.claude/settings.json` 의 SessionStart 훅이 `setup.sh` 를 자동으로
돌린다. JDK 17+ (jlink 포함)는 미리 깔려 있어야 한다.
