# Screens — the fixed set

Every round, **all of them are retaken** under the same names, and a picture that did not change is not written again,
so git shows only the screens that changed. "Did not change" means the same size, at most 20 pixels more than 2 levels
apart and none more than 24: the renderer's anti-aliasing noise. For that the windows' clock is fixed (the Assemble
panel shows the assemble's time, 01:00:00). All of them are taken by `tools/capture-screens.ts` (none by hand); the
example files and step counts are written inside the tool. (The Hallym MIPS edition's set, v2.7.1, for this app: the
same names where the scene is the same.)

- Two retakes in a row rewrite nothing but `start-1093.webp` and `start-2-1093.webp` (measured 2026-10-04). The
  Editor's pictures had been rewritten every round: the error list coming in shrinks the Editor, and a Ctrl+Home
  before CodeMirror had measured that left it scrolled 29 px in one take and 31 in the next; the capture now waits
  two frames and 0.5 s before a key moves the Editor and before every picture, and both takes end at 3 px. The two
  1093 pictures are not fixed: at 1.25× two takes of the same moment differ by one level on 150-185 of their
  997,272 pixels (the rasteriser, PNGs compared), and the lossy WebP turns that into differences of up to 18 levels
  over the whole picture, which the "did not change" rule above does not let through.
- To retake: in `electron/`, `xvfb-run -a -s '-screen 0 2400x1400x24' npm run screens` (Linux, xvfb software rendering).
- Default: the whole window at 1280×800. No mouse cursor, tooltips or hover; focus cleared.
- Format and size: **WebP**, every one of them (`tools/webp.ts`, encoded by the app's own Chromium). Whole windows 400 KB or
  less, crops 150 KB or less; `tests/docs/pictures.test.ts` fails on any picture of the documents over 400 KB or not WebP.
  The window's screens are lossless (the same pixels as a PNG, in less). The first screen's shots are lossy at quality
  0.85: the board the program draws is thin bright lines on a dark ground, which is what JPEG did worst.
- The window buttons (minimize, maximize, close) are drawn by Windows, so they are not in a page capture:
  `windows-frame.webp` and the installer's pictures come from the Windows CI job (artifact `windows-report`).

| File | What | Capture conditions |
|---|---|---|
| `start.webp` | The first screen: the circuit board settled, the card as its chip — the university's symbol, "Hallym RISC-V Simulator", 바로 시작 / 튜토리얼 보기; no toolbar | 1280×800, the board's clock at 12.0 s (settled; it grows for about 8.3 s) |
| `start-2.webp` | Its second step: 새 파일 / 파일 열기, "← 처음으로" | 1280×800, 바로 시작 |
| `start-frame-1.webp`, `start-frame-3.webp` | The board's opening at two more moments (with `start.webp`, three) | the board's clock at 1.0 and 5.0 s |
| `start-1093.webp`, `start-2-1093.webp` | The two steps on the lab PC | CSS 1093×582 at 1.25× |
| `start-1024.webp`, `start-2-1024.webp` | The two steps at 1024×768 | CSS 1024×728 |
| `start-910.webp`, `start-2-910.webp` | The two steps in the narrow window | CSS 910×505 at 1.5× |
| `start-1920.webp`, `start-2-1920.webp` | The two steps on a maximised 1920 screen | 1920×1040 |
| `split-before.webp` | Editor and Run before assembling: the Run side's card (Haram) | `tests/samples/lab04-ok.s` opened as `lab04.s` |
| `assembled.webp` | Just assembled: the Assemble panel's line, the Inspector's word, the empty Console | the same, Ctrl+S |
| `split-running.webp` | Running: the line in the Editor and in Text, Registers with both names (`x9 s1`), the yellow row named in the status bar | the same, F10 ×12 (PC `0x00400030`, `s1` just changed by `srli`) |
| `inspector.webp` | The Inspector pinned to an I-type shift (`srai s2, t6, 1`: funct7, shamt) | from `split-running`, `0x00400030` clicked in Text |
| `inspector-R.webp`, `inspector-I.webp`, `inspector-U.webp`, `inspector-S.webp`, `inspector-B.webp`, `inspector-J.webp` | The Inspector in each of the six formats: `add` (R), `addi` (I), `lui` (U), `sw` (S), `bne` (B), `jal` (J) — the word in its fields, and under it the immediate's scattered pieces put together, coloured as in the word, with the always-0 bits (B, J, U) and the sign extension | 1280×800, the program of `tests/e2e/inspector-formats.e2e.ts`, one step each |
| `dialog.webp` | The window's own question (Haram): a new file over a saved one | from `inspector`, New file |
| `edited.webp` | The code changed after assembling: the machine kept, the band over it | from `split-running`, a comment typed on line 1 |
| `error-kept.webp` | An error in the changed code: the list under the Editor, the machine kept | `srll t5, t6, 1` added, Ctrl+S |
| `error.webp` | The first assemble with an error: RARS's words, the line, the hint "srll 명령은 없습니다. 혹시 srl?" | `tests/samples/lab04.s` (line 15), Ctrl+S |
| `error-near-miss.webp` | A MIPS habit named: `syscall` → `ecall` | a file with `syscall`, Ctrl+S |
| `error-several.webp` | Several errors, each with its line | `tests/samples/editor-errors.s` |
| `data.webp` | Data: the data segment and the stack, labels, `sp` `gp` `fp`, the ASCII column | `tests/samples/data-labels.s`, F10 ×14, Data tab |
| `max-1920.webp` | A maximised 1920 screen: the Editor at 72 columns, the rest for the Run side | 1920×1040, the `split-running` run |
| `errors-max.webp` | The error list on a maximised 1920 screen | 1920×1040, `tests/samples/lab04.s` |
| `lab-1366x768-125.webp` | The lab PC: 1366×768 at 125%, maximised | CSS 1093×582 at 1.25× |
| `lab-columns.webp` | Its Registers and Text heads, cropped | the same, the top 190 px |
| `narrow.webp` | The narrow window: Editor / Run tabs in the bar, the Run side | 1366×768 at 150%: CSS 910×505 at 1.5× |
| `1024x768.webp` | 1024×768: still side by side | CSS 1024×728 |
| `tutorial-01.webp` | Tutorial step 1: the Editor lit whole, boxes on its head and first lines, the card and Haram | 튜토리얼 보기 → step 1 |
| `tutorial-02.webp` | Step 2: Assemble, the card right under the button | step 2 |
| `tutorial-03.webp` | Step 3: Registers — two names for each register (`x5 t0`), the Temporaries | step 3 |
| `tutorial-04.webp` | Step 4: one line, two instructions (`li t0, 0x12345678` → `lui` + `addi`) | step 4 |
| `tutorial-05.webp` | Step 5: Step, at `main`'s third line (no start-up code in RISC-V) | step 5 |
| `tutorial-09.webp` | Step 9: the bit grid (funct7 rs2 rs1 funct3 rd opcode) = the Encoding | step 9 |
| `tutorial-09-narrow.webp` | Step 9 in the narrow window | CSS 910×505 at 1.5× |
| `tutorial-14.webp` | Step 14: the breakpoint gutter and its line, one ring | step 14 |
| `tutorial-quit-ask.webp` | The quit question over step 14 | 그만두기 |
| `tutorial-18-done.webp` | Step 18 done: the Console's output pointed at | step 18, F5 |
| `tutorial-19.webp` | Step 19: the Assemble panel after the error example (`adi` → 혹시 `addi`?) | step 19, Ctrl+S |
| `tutorial-20.webp` | Step 20: "여기가 고칠 줄입니다", the cursor on the line, the line marked | 4행으로 가기 |
| `tutorial-21.webp` | Step 21: the end | step 21 |
| `font-24-narrow.webp` | The biggest font (24 px) in the narrowest window, a long file name | CSS 910×505 at 1.5×, Ctrl+= ×11 |
| `titlebar-24-narrow.webp` | Its title bar, cropped | the same, the top 40 px |

From the Windows CI job (the installed program on the runner's 1920×1080 screen), committed by its `pictures` job:

| File | What | Capture conditions |
|---|---|---|
| `windows-frame.webp` | The whole Windows screen, the window maximised: Windows' own caption buttons on the title bar | the installed app, the `split-running` run (`tools/capture-screens.ts`) |
| `windows-frame-tutorial.webp` | The same with the tutorial on: the caption buttons' patch dimmed with the window | tutorial step 14 |
| `installer-progress.webp` | The installer's first page: the progress, the bar in the app's blue | `tools/windows/check-installer-ui.ps1` |
| `installer-finish.webp` | Its second and last page: "설치가 완료되었습니다", "지금 실행하기" ticked, 마침; the navy band with the symbol | the same |
| `installer-started.webp` | The program 마침 started: its first screen | the same |
| `uninstaller-finish.webp` | The uninstaller's finish page: "제거가 끝났습니다" | the same |
