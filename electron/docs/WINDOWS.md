# Windows: the installer, what CI checks, releasing and rolling back

(The Hallym MIPS edition's WINDOWS.md, v2.7.1, for this app.  What differs: the engine is a Java
program of its own, with its own runtime inside the installer; there is no Qt edition to sit beside.)

## The installer

One file, `HallymRISCV-<version>-win-x64-setup.exe` (NSIS, per user), made by `tools/package.ts` in the
Windows CI job. Two pages, in Korean: the progress (the bar in the app's blue), then "설치가 완료되었습니다" with
"지금 실행하기" ticked and 마침. No folder to choose, no "for all users", no welcome or licence page, no
elevation: `%LOCALAPPDATA%\Programs\Hallym RISC-V`, a Start menu entry "Hallym RISC-V", an uninstall entry
"Hallym RISC-V <version>" under HKCU, no desktop shortcut, no file association. `/S` installs silently and starts
nothing (`tools/windows/install-silent.ps1` watches for 15 s).

What it is made of (`build/package/sizes.json`, written by `tools/package.ts`; the numbers of each run are in
its artifact `windows-report`, `sizes.json`). Measured on the CI run of 2026-10-02 (version 0.1.0):

| | unpacked | what |
|---|---|---|
| Electron | 320.3 MB | `HallymRISCV.exe` (Chromium + Node), its DLLs, locales, `resources\elevate.exe` |
| Java runtime | 46.2 MB | `resources\engine\runtime`: Eclipse Temurin 21.0.12+1 by jlink — java.base, java.prefs, java.desktop (and java.datatransfer, java.xml, which java.desktop needs), zip-9, no debug data |
| RARS | 1.8 MB | `resources\engine\rars.jar`, built from RARS's tag v1.6 (`probe/setup.sh`) |
| the engine | < 0.1 MB | `resources\engine\classes`: `RarsProbe` (`probe/src`) |
| the app | 7.4 MB | `resources\app.asar`: the window, fonts, characters, the first screen's video |
| **installer** | **134.0 MB** (140,534,430 bytes) | NSIS, LZMA |

The installer is not byte-reproducible (NSIS writes the build time into it): only the published file's size and
SHA-256 mean anything.

## The engine on Windows (tools/engine-windows.ts, tests/e2e/engine-process.e2e.ts)

Measured on the Windows runner, each with a negative control that fails:

- **No console window.** `java.exe` is a console program; started from a window it would get a black console
  window at every start and restart. It is started with `windowsHide`; a watcher that lists every visible window
  every 20 ms (`tools/windows/console-windows.ps1`) sees none. Control: `ENGINE_WINDOWS_HIDE=0` shows one.
- **Killing.** Windows has no signals: `kill('SIGKILL')` is `TerminateProcess`; the exit is reported in about
  10 ms and the process is gone. Control: a polite end (closing stdin) against an engine that ignores it leaves
  it running.
- **No orphans.** The engine leaves when the process that started it is gone (`-Dhallym.parent`, Java's
  `ProcessHandle.onExit`) or when its stdin ends. Both are needed: an Electron main process killed outright on
  Windows left both engines running before the first was added. (A Node parent's children are also in libuv's
  job object, which kills them with it.) Control: an engine that ignores both, started outside the job object,
  stays.
- **Korean through stdio.** Every stream is UTF-8 whatever the code page (`-Dfile.encoding=UTF-8` and the
  stdout/stderr encodings). Control: `-Dfile.encoding=COMPAT` (the code page) garbles a Korean round trip.
- **Cold start**: a fresh engine ready in about 0.22–0.24 s (median of ten), the first assemble answered in
  about 0.25 s, with the JDK and with the installed jlink runtime alike.

## What CI checks on Windows (.github/workflows/electron.yml, job `windows`)

The screen set to 1920×1080 and Windows' animation effects on (with them off, Chromium reports
prefers-reduced-motion and the first screen shows its still), then: type check, unit tests, the documents'
links, the engine measured with the JDK; the installer built; `/S`; the engine measured again with the installed
runtime; every e2e test against the **installed** program, at its own size and with 1920×1040 as every test's
window; the real Microsoft Korean IME (an attempt, reported either way: the CDP tests are the ones that count);
the fixed screens captured on Windows; the installer run as a student runs it, with its pages, pictured
(`tools/windows/check-installer-ui.ps1`), and uninstalled with the uninstaller's pages. The job `upgrade` then
installs this build over the latest published release (before the first release: alone, then over itself:
`tools/windows/check-upgrade.ps1`).

## Releasing, and after publishing

A release is made by pushing a tag `v<x.y.z>` on a commit whose `electron/package.json` has that version and which
carries the notes `electron/docs/releases/<version>.md` (the rules: `CLAUDE.md`, "Electron 판 배포 규칙"). That
commit's own run on main has already built it, run every e2e against the installed program, run the installer with
its pages, and installed it over the latest release. The tag's workflow builds nothing: its job `tested` finds that
run (its commit must be the tag's, its jobs green, the upgrade really run) and takes its installer; `publish`
publishes that very file — not a pre-release, Latest, the SHA-256 added to the notes. Then **Release check (as
downloaded)** (`release-check.yml`): the release is Latest with the installer as its only file, every earlier
release still there, the installer downloaded from the public address has the SHA-256 of the notes, it installs on
a clean runner, every e2e test passes against it, and every link and picture of the README and the user guide opens
at the tag. A failure in any of these opens an issue ("Release v<x.y.z> failed").

## Rolling back a release

If the latest release causes trouble in the labs, it is taken back and the release before it is the latest again.
Everything links to `releases/latest` (the README, the user guide). Below, `<bad>` is the version taken back and
`<previous>` the one before it. (While 1.0.0 is the only release there is nothing to go back to: take it back as in
1–2 and tell the students to use Hallym MIPS meanwhile.)

1. Turn the release back into a draft (its file stays, visible only to the maintainers):

   ```sh
   gh release edit v<bad> --repo ars2323/hallym-riscv-simulator --draft
   ```

2. Delete the tag, on GitHub and locally:

   ```sh
   git push origin --delete v<bad>
   git tag -d v<bad>
   ```

3. Make the earlier release the latest, and check:

   ```sh
   gh release edit v<previous> --repo ars2323/hallym-riscv-simulator --latest
   gh release list --repo ars2323/hallym-riscv-simulator   # v<previous> marked Latest, no v<bad>
   ```

4. Tell the students (in Korean, a notice for the course page):

   > Hallym RISC-V <bad> 버전에 문제가 있어 잠시 이전 버전인 <previous> 버전으로 돌아갑니다.
   > - 먼저 설정 → 앱 → 설치된 앱 → "Hallym RISC-V <bad>" → 제거를 누르세요.
   > - 릴리스 페이지에서 <previous> 버전의 설치 파일을 받아 설치하세요: <https://github.com/ars2323/hallym-riscv-simulator/releases/latest>
   > - 저장한 `.s` 파일은 그대로 열 수 있습니다.

5. The fix goes out as a new version (a patch), never under the tag taken back.
