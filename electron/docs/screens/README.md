# Screens — the fixed set

Every round, **all of them are retaken** under the same names, and a picture that did not change is not written again,
so git shows only the screens that changed. "Did not change" means the same size, at most 20 pixels more than 2 levels
apart and none more than 24: the renderer's anti-aliasing noise. For that the windows' clock is fixed (the Assemble
panel shows the assemble's time, 01:00:00). All of them are taken by `tools/capture-screens.ts` (none by hand); the
example files and step counts are written inside the tool. (The Hallym MIPS edition's set, v2.7.1, for this app: the
same names where the scene is the same.)

- To retake: in `electron/`, `xvfb-run -a -s '-screen 0 2400x1400x24' npm run screens` (Linux, xvfb software rendering).
- Default: the whole window at 1280×800. No mouse cursor, tooltips or hover; focus cleared.
- Size: whole window 400 KB or less, crops 150 KB or less, metadata stripped, lossless. The first screen's shots are
  JPEG (quality 85, 250 KB or less): the university's video is behind them, stopped at a fixed second.
- The window buttons (minimize, maximize, close) are drawn by Windows, so they are not in a page capture:
  `windows-frame.png` and the installer's pictures come from the Windows CI job (artifact `windows-report`).

| File | What | Capture conditions |
|---|---|---|
| `start.jpg` | The first screen: Haram's greeting, "RISC-V 어셈블리를 쓰고, 어셈블하고, 한 줄씩 실행해 보는 곳입니다", 튜토리얼 보기 / 바로 시작, no toolbar; the video under its blur and navy tint, the glass card and bars | 1280×800, the video stopped at 3.0 s |
| `start-2.jpg` | Its second step: 새 파일 / 파일 열기, "← 처음으로" | 1280×800, 바로 시작 |
| `start-frame-1.jpg`, `start-frame-3.jpg` | The first screen at two more moments of the video (with `start.jpg`, three) | the video at 0.5 and 5.5 s |
| `start-1093.jpg`, `start-2-1093.jpg` | The two steps on the lab PC | CSS 1093×582 at 1.25× |
| `start-1024.jpg`, `start-2-1024.jpg` | The two steps at 1024×768 | CSS 1024×728 |
| `start-910.jpg`, `start-2-910.jpg` | The two steps in the narrow window | CSS 910×505 at 1.5× |
| `start-1920.jpg`, `start-2-1920.jpg` | The two steps on a maximised 1920 screen | 1920×1040 |
| `split-before.png` | Editor and Run before assembling: the Run side's card (Haram) | `tests/samples/lab04-ok.s` opened as `lab04.s` |
| `assembled.png` | Just assembled: the Assemble panel's line, the Inspector's word, the empty Console | the same, Ctrl+S |
| `split-running.png` | Running: the line in the Editor and in Text, Registers with both names (`x9 s1`), the yellow row named in the status bar | the same, F10 ×12 (PC `0x00400030`, `s1` just changed by `srli`) |
| `inspector.png` | The Inspector pinned to an I-type shift (`srai s2, t6, 1`: funct7, shamt) | from `split-running`, `0x00400030` clicked in Text |
| `inspector-R.png`, `inspector-I.png`, `inspector-U.png`, `inspector-S.png`, `inspector-B.png`, `inspector-J.png` | The Inspector in each of the six formats: `add` (R), `addi` (I), `lui` (U), `sw` (S), `bne` (B), `jal` (J) — the word in its fields, and under it the immediate's scattered pieces put together, coloured as in the word, with the always-0 bits (B, J, U) and the sign extension | 1280×800, the program of `tests/e2e/inspector-formats.e2e.ts`, one step each |
| `dialog.png` | The window's own question (Haram): a new file over a saved one | from `inspector`, New file |
| `edited.png` | The code changed after assembling: the machine kept, the band over it | from `split-running`, a comment typed on line 1 |
| `error-kept.png` | An error in the changed code: the list under the Editor, the machine kept | `srll t5, t6, 1` added, Ctrl+S |
| `error.png` | The first assemble with an error: RARS's words, the line, the hint "srll 명령은 없습니다. 혹시 srl?" | `tests/samples/lab04.s` (line 15), Ctrl+S |
| `error-near-miss.png` | A MIPS habit named: `syscall` → `ecall` | a file with `syscall`, Ctrl+S |
| `error-several.png` | Several errors, each with its line | `tests/samples/editor-errors.s` |
| `data.png` | Data: the data segment and the stack, labels, `sp` `gp` `fp`, the ASCII column | `tests/samples/data-labels.s`, F10 ×14, Data tab |
| `max-1920.png` | A maximised 1920 screen: the Editor at 72 columns, the rest for the Run side | 1920×1040, the `split-running` run |
| `errors-max.png` | The error list on a maximised 1920 screen | 1920×1040, `tests/samples/lab04.s` |
| `lab-1366x768-125.png` | The lab PC: 1366×768 at 125%, maximised | CSS 1093×582 at 1.25× |
| `lab-columns.png` | Its Registers and Text heads, cropped | the same, the top 190 px |
| `narrow.png` | The narrow window: Editor / Run tabs in the bar, the Run side | 1366×768 at 150%: CSS 910×505 at 1.5× |
| `1024x768.png` | 1024×768: still side by side | CSS 1024×728 |
| `tutorial-01.png` | Tutorial step 1: the Editor lit whole, boxes on its head and first lines, the card and Haram | 튜토리얼 보기 → step 1 |
| `tutorial-02.png` | Step 2: Assemble, the card right under the button | step 2 |
| `tutorial-03.png` | Step 3: Registers — two names for each register (`x5 t0`), the Temporaries | step 3 |
| `tutorial-04.png` | Step 4: one line, two instructions (`li t0, 0x12345678` → `lui` + `addi`) | step 4 |
| `tutorial-05.png` | Step 5: Step, at `main`'s third line (no start-up code in RISC-V) | step 5 |
| `tutorial-09.png` | Step 9: the bit grid (funct7 rs2 rs1 funct3 rd opcode) = the Encoding | step 9 |
| `tutorial-09-narrow.png` | Step 9 in the narrow window | CSS 910×505 at 1.5× |
| `tutorial-14.png` | Step 14: the breakpoint gutter and its line, one ring | step 14 |
| `tutorial-quit-ask.png` | The quit question over step 14 | 그만두기 |
| `tutorial-18-done.png` | Step 18 done: the Console's output pointed at | step 18, F5 |
| `tutorial-19.png` | Step 19: the Assemble panel after the error example (`adi` → 혹시 `addi`?) | step 19, Ctrl+S |
| `tutorial-20.png` | Step 20: "여기가 고칠 줄입니다", the cursor on the line, the line marked | 4행으로 가기 |
| `tutorial-21.png` | Step 21: the end | step 21 |
| `font-24-narrow.png` | The biggest font (24 px) in the narrowest window, a long file name | CSS 910×505 at 1.5×, Ctrl+= ×11 |
| `titlebar-24-narrow.png` | Its title bar, cropped | the same, the top 40 px |

From the Windows CI job (the installed program on the runner's 1920×1080 screen), committed by its `pictures` job:

| File | What | Capture conditions |
|---|---|---|
| `windows-frame.png` | The whole Windows screen, the window maximised: Windows' own caption buttons on the title bar | the installed app, the `split-running` run (`tools/capture-screens.ts`) |
| `windows-frame-tutorial.png` | The same with the tutorial on: the caption buttons' patch dimmed with the window | tutorial step 14 |
| `installer-progress.png` | The installer's first page: the progress, the bar in the app's blue | `tools/windows/check-installer-ui.ps1` |
| `installer-finish.png` | Its second and last page: "설치가 완료되었습니다", "지금 실행하기" ticked, 마침; the navy band with the symbol | the same |
| `installer-started.png` | The program 마침 started: its first screen | the same |
| `uninstaller-finish.png` | The uninstaller's finish page: "제거가 끝났습니다" | the same |
