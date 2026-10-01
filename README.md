# Hallym RISC-V Simulator

한림대학교 컴퓨터구조 수업용 RISC-V 시뮬레이터(Hallym MIPS Simulator 의 RISC-V 판)를
만들기 위한 저장소다. **지금은 1단계: 앱이 없다.** RARS(Java)를 수정 없이 JVM 째로
싣고 stdio JSON 으로 구동하는 길(②)이 성립하는지만 재는 탐침(`probe/`)과 그 측정값,
결정을 담고 있다. 결과는 [`probe/REPORT.md`](probe/REPORT.md) 에 있다.

    probe/setup.sh         # JDK 확인, RARS v1.6 jar + 소스(고정 커밋) 설치 및 소스 빌드
    probe/run.sh all       # 래퍼 빌드 → 측정(bench.py) → 검사(checks.py)
