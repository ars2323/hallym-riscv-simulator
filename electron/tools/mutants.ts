/* Shows that the tests catch a wrong module, before they are trusted to say
   a right one is right.

     node tools/mutants.ts [FILTER]            every mutant (or those whose "module what" holds FILTER)
     node tools/mutants.ts --changed           only those the changes since the baseline could touch
       --list            say which would run, and why; run nothing
       --jobs N          N mutants at a time (default: a third of the cores, 1 to 6)
       --shard I/N       the I-th of N parts of the selection (CI: .github/workflows/mutants.yml)
       --no-control      skip the control (on by default): first the selection's tests are run with
                         no mutant, since a failure there would make every kill meaningless (a test
                         failing on its own reads as a kill), so the run stops
       --json FILE       the results: each mutant, killed or not, by which test, in how many seconds
     node tools/mutants.ts --check             every mutant's `find` exactly once in its `file`; nothing built or run
     node tools/mutants.ts --merge OUT IN...   one result from the shards' JSON; fails unless every mutant is in it, killed
     node tools/mutants.ts --baseline-from MERGED [--run URL]
                                               print the baseline record of a green full pass (to commit by hand)
     node tools/mutants.ts --verify-selector   the selector's own checks, in a temporary git worktree

   Each mutant changes one thing in one file -- the text `find` must occur
   exactly once -- in a copy of src/, tests/ and tools/ in a temporary
   directory, <tmp>/electron (node_modules/ is linked, not copied, and the
   repository's probe/ -- the engine's classes -- is linked at <tmp>/probe),
   and runs the tests named for it there.  (The list: the Hallym MIPS
   edition's mutants that apply to the code the two editions share as it
   is, and this edition's own -- the engine boundary, the decoder's six
   formats, the registers' two names and 64-bit f registers, the
   Inspector's immediate, the hints, the tutorial's RISC-V content.)  A mutant is
   KILLED when those tests fail; one that survives, or does not apply, fails
   this script.  Nothing in the working tree is touched.

   --changed.  The baseline, tools/mutants-baseline.json, is a full pass
   that killed every mutant: its commit, date, and the mutants it killed.
   From it, a mutant runs if its `file` or one of its `tests` changed since
   that commit -- committed (git diff <sha>..HEAD) or not (git status:
   staged, unstaged, untracked) -- or if it is not among the baseline's.
   The rest were killed at the baseline against the same code and tests,
   and are listed as skipped, each with why; that none of them has a file in
   the changes is checked again before anything runs.  Whenever the change
   set cannot be trusted, it runs them all and says why: no baseline file,
   the baseline commit not an ancestor of HEAD, git not answering, a
   mutant's file or test missing.  The find check runs first in every mode:
   a `find` that does not occur exactly once stops everything.

   Tests named *.e2e.ts run the real window through Playwright (the copy's
   window script is bundled first); they need a display.  On Linux each
   worker gets its own (xvfb-run -n, from :120 up) when there is none or
   when more than one runs at a time; otherwise the one in DISPLAY.
*/

import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

const root = path.join(import.meta.dirname, '..');

interface Mutant {
  module: string;
  file: string;
  find: string;
  replace: string;
  tests: string[];
  what: string;
  rebuild?: boolean; // the mutant is in native/src: build the addon again
}

const MUTANTS: Mutant[] = [
  // ---- The Hallym MIPS edition's (v2.7.1), on the code the two editions share as it is: the window,
  // the title bar's steps, the first screen, the tutorial's mechanics.  (Its other 72 were SPIM's or
  // the MIPS edition's own code, which is not here.)
  { module: "format", file: "src/core/format.ts", what: "nibbles joined with _",
    find: ".match(/.{4}/g)!.join(' ')", replace: ".match(/.{4}/g)!.join('_')", tests: ["tests/core/format.test.ts"] },
  { module: "format", file: "src/core/format.ts", what: "decimal below INT32_MIN accepted",
    find: "parsed < -2147483648n", replace: "parsed < -2147483649n", tests: ["tests/core/format.test.ts"] },
  { module: "format", file: "src/core/format.ts", what: "signed decimal printed unsigned",
    find: "String(value | 0)", replace: "String(value >>> 0)", tests: ["tests/core/format.test.ts"] },
  { module: "memory-rows", file: "src/core/memory-rows.ts", what: "three zero words make a run",
    find: "if (zeros >= 4) {", replace: "if (zeros >= 3) {", tests: ["tests/core/memory-rows.test.ts"] },
  { module: "memory-rows", file: "src/core/memory-rows.ts", what: "no short first line",
    find: "if (from % LINE === 0 || from >= to) return from;", replace: "if (from % WORD === 0 || from >= to) return from;", tests: ["tests/core/memory-rows.test.ts"] },
  { module: "memory-text", file: "src/core/memory-text.ts", what: "'~' shown as '.'",
    find: "c >= 0x20 && c <= 0x7e", replace: "c >= 0x20 && c < 0x7e", tests: ["tests/core/memory-text.test.ts"] },
  { module: "memory-text", file: "src/core/memory-text.ts", what: "bytes and halves unsigned in decimal",
    find: "return String(v & (1 << (bits - 1)) ? v - (1 << bits) : v);", replace: "return String(v);", tests: ["tests/core/memory-text.test.ts"] },
  { module: "text-file", file: "src/node/text-file.ts", what: "byte order mark not noted",
    find: "    byteOrderMark = true;\n    bytes = bytes.subarray(3);", replace: "    bytes = bytes.subarray(3);", tests: ["tests/node/text-file.test.ts"] },
  { module: "text-file", file: "src/node/text-file.ts", what: "anything not UTF-8 taken for CP949",
    find: "if (sameBytes(iconv.encode(korean, 'cp949'), bytes)) {", replace: "if (true) {", tests: ["tests/node/text-file.test.ts"] },
  { module: "text-file", file: "src/node/text-file.ts", what: "CRLF counted as LF",
    find: "lineEnd: crlf > lf ? 'CRLF' : 'LF'", replace: "lineEnd: 'LF'", tests: ["tests/node/text-file.test.ts"] },
  { module: "sim host", file: "src/sim/host.ts", what: "no restart after a crash by default",
    find: "this.restartOnCrash = options.restartOnCrash ?? true;", replace: "this.restartOnCrash = options.restartOnCrash ?? false;", tests: ["tests/sim/process.test.ts"] },
  { module: "sim host", file: "src/sim/host.ts", what: "stop() kills at once",
    find: "      const stopCall = this.call('stop');", replace: "      kill(); return 'killed';\n      const stopCall = this.call('stop');", tests: ["tests/sim/process.test.ts"] },
  { module: "renderer logic", file: "src/renderer/app/logic/virtual.ts", what: "no rows kept around the view",
    find: "overscan = 10", replace: "overscan = 0", tests: ["tests/renderer/logic.test.ts"] },
  { module: "renderer logic", file: "src/renderer/app/logic/virtual.ts", what: "scrolls without a margin",
    find: "margin = 2", replace: "margin = 0", tests: ["tests/renderer/logic.test.ts"] },
  { module: "window", file: "src/main/main.ts", what: "the run folder left behind after the app exits",
    find: "    spawn(process.execPath, ['-e', script], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }).unref();", replace: "    void script;", tests: ["tests/e2e/settings.e2e.ts"] },
  { module: "window", file: "src/main/main.ts", what: "a run starts from other settings than the defaults",
    find: "let settings: Settings = { ...DEFAULT_SETTINGS };", replace: "let settings: Settings = { ...DEFAULT_SETTINGS, fontSize: 15, dataBase: 10 };", tests: ["tests/e2e/settings.e2e.ts"] },
  { module: "window", file: "src/main/paths.ts", what: "a notice missing from About",
    find: "  { name: 'lucide-LICENSE.txt', title: 'Lucide icons — ISC License' },\n", replace: "", tests: ["tests/e2e/settings.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.ts", what: "Esc waits out a slow run's second",
    find: "slow = { cancel: () => { cancelled = true; wake?.(); } };", replace: "slow = { cancel: () => { cancelled = true; } };", tests: ["tests/e2e/panels.e2e.ts"] },
  { module: "window", file: "src/renderer/app/panels/data.ts", what: "Data addresses without 0x",
    find: "code(hex32(base16), 'daddr')", replace: "code(hex32(base16).slice(2), 'daddr')", tests: ["tests/e2e/panels.e2e.ts"] },
  { module: "window", file: "src/renderer/app/panels/console.ts", what: "Console folded at the start",
    find: "  expanded = true;", replace: "  expanded = false;", tests: ["tests/e2e/panels.e2e.ts"] },
  { module: "window", file: "src/renderer/app/editor.ts", what: "Ctrl+S saves in the middle of a syllable",
    find: "    if (composing) saveAfterComposition = true;\n    else onSave();", replace: "    onSave();", tests: ["tests/e2e/ime.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.ts", what: "Ctrl+S in the middle of a syllable taken as not composing",
    find: "editor.requestSave(e.isComposing)", replace: "editor.requestSave(false)", tests: ["tests/e2e/ime.e2e.ts"] },
  { module: "window", file: "src/renderer/app/panels/console.ts", what: "Console Enter taken in the middle of a syllable",
    find: "if (e.key === 'Enter' && !e.isComposing) {", replace: "if (e.key === 'Enter') {", tests: ["tests/e2e/ime.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.css", what: "mono spans in the UI font",
    find: ".mono { font-family: var(--code); }", replace: ".mono { font-family: var(--ui); }", tests: ["tests/e2e/hex-mono.e2e.ts"] },
  { module: "window", file: "src/renderer/app/panels/inspector.ts", what: "Inspector heading in the UI font",
    find: "code(row.disassembly, 'dis')", replace: "h('span', { class: 'dis' }, row.disassembly)", tests: ["tests/e2e/hex-mono.e2e.ts"] },
  { module: "window", file: "src/renderer/app/panels/registers.ts", what: "every row marked changed",
    find: "row.el.classList.toggle('chg', isChanged);", replace: "row.el.classList.toggle('chg', true);", tests: ["tests/e2e/flows.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.ts", what: "the executed line not followed in the Editor",
    find: "editor.showPcLine(current() && runState !== 'ready' ? pcSourceLine() : null);", replace: "editor.showPcLine(null);", tests: ["tests/e2e/layout.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.ts", what: "the Editor marks a line while its code has changed",
    find: "editor.showPcLine(current() && runState !== 'ready' ? pcSourceLine() : null);", replace: "editor.showPcLine(machineShown() && runState !== 'ready' ? pcSourceLine() : null);", tests: ["tests/e2e/editing.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.ts", what: "changed code hides the machine",
    find: "const machineShown = () => assembledText !== null;", replace: "const machineShown = () => assembledText !== null && !edited;", tests: ["tests/e2e/editing.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.ts", what: "F10 after an edit assembles the Editor's code",
    find: "  if (assembledText === null) {\n    if (!open) return false;\n    return saveAndAssemble();", replace: "  if (assembledText === null || edited) {\n    if (!open) return false;\n    return saveAndAssemble();", tests: ["tests/e2e/editing.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.css", what: "the Assemble panel as tall as it likes",
    find: ".asm { height: var(--asm-h, auto); max-height: var(--asm-max, 45%); }", replace: ".asm { height: var(--asm-h, auto); }", tests: ["tests/e2e/editing.e2e.ts"] },
  { module: "window", file: "src/renderer/app/panels/console.ts", what: "Enter does not hand the line on",
    find: "        this.onInput(line);\n", replace: "", tests: ["tests/e2e/flows.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.ts", what: "a saved file dropped for a new one without asking",
    find: "  if (what === 'new') {", replace: "  if (false) {", tests: ["tests/e2e/editor.e2e.ts"] },
  { module: "window", file: "src/renderer/app/editor.ts", what: "Enter copies the indentation above",
    find: "{ key: 'Enter', run: insertNewline },", replace: "", tests: ["tests/e2e/editor.e2e.ts"] },
  { module: "window", file: "src/renderer/app/editor.ts", what: "an error marked with a breakpoint's dot",
    find: "s.className = 'cm-error-mark';", replace: "s.className = 'cm-bp-dot';", tests: ["tests/e2e/editor.e2e.ts"] },
  { module: "window", file: "src/renderer/app/editor.ts", what: "breakpoint marks left behind by edits",
    find: "    set = set.map(tr.changes); // they move with the text", replace: "", tests: ["tests/e2e/editor.e2e.ts"] },
  { module: "columns", file: "src/renderer/app/logic/columns.ts", what: "a column given up before it has to",
    find: "const hidden = new Set(drops.slice(0, k).flat());", replace: "const hidden = new Set(drops.slice(0, k + 1).flat());", tests: ["tests/renderer/columns.test.ts"] },
  { module: "columns", file: "src/renderer/app/logic/columns.ts", what: "a column turned back on stays off",
    find: "const hidden = new Set([...auto.hidden].filter((key) => !forced.has(key)));", replace: "const hidden = new Set(auto.hidden);", tests: ["tests/renderer/columns.test.ts"] },
  { module: "columns", file: "src/renderer/app/logic/columns.ts", what: "the smaller font before the tighter margins",
    find: "    { name: 'tight', ...tight, scale: 1 },\n    { name: 'small', ...tight, scale: (fontPx - 1) / fontPx },", replace: "    { name: 'small', ...tight, scale: (fontPx - 1) / fontPx },\n    { name: 'tight', ...tight, scale: 1 },", tests: ["tests/renderer/columns.test.ts"] },
  { module: "window", file: "src/renderer/app/panels/registers.ts", what: "Bin given up before Dec",
    find: "const DROPS = [['dec'], ['bin']];", replace: "const DROPS = [['bin'], ['dec']];", tests: ["tests/e2e/fit.e2e.ts"] },
  { module: "window", file: "src/renderer/app/panels/text.ts", what: "Encoding given up first",
    find: "const DROPS = [['src', 'lno'], ['fmt'], ['addr'], ['word']];", replace: "const DROPS = [['word'], ['src', 'lno'], ['fmt'], ['addr']];", tests: ["tests/e2e/fit.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.ts", what: "the Editor keeps its 72 columns however narrow the window",
    find: "Math.min(editorMost(), inner - runLeast)", replace: "editorMost()", tests: ["tests/e2e/fit.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.ts", what: "the Editor wider than 72 columns need",
    find: "const EDITOR_COLUMNS = 72;", replace: "const EDITOR_COLUMNS = 100;", tests: ["tests/e2e/fit.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.css", what: "the empty Console as tall as with output",
    find: ".console.open.is-empty { height: var(--console-h, auto); }\n", replace: "", tests: ["tests/e2e/layout.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.ts", what: "the grip over the Console does nothing",
    find: "  else leftCol.style.setProperty('--console-h', `${consoleHeight}px`);", replace: "", tests: ["tests/e2e/layout.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.ts", what: "the line number in the Errors title as well",
    find: "  const title = errors.length > 1 ? `코드에 오류가 ${errors.length}개 있습니다` : '코드에 오류가 있습니다';", replace: "  const title = `${first.line}행을 고친 뒤 다시 Ctrl+S 키를 누르세요`;", tests: ["tests/e2e/editor.e2e.ts"] },
  { module: "tutorial", file: "src/renderer/app/tutorial.ts", what: "a line of instructions under the card's text again",
    find: "        h('p', {}, codeText((res ?? step).body(this))),\n", replace: "        h('p', {}, codeText((res ?? step).body(this))),\n        step.kind === 'practice' ? h('p', { class: 'tut-doing' }, '직접 해 보세요') : null,\n", tests: ["tests/e2e/tutorial.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.css", what: "the Inspector's empty word at the top of the panel",
    find: ".insp .ibody.is-empty { display: flex; }\n", replace: "", tests: ["tests/e2e/notices.e2e.ts"] },
  { module: "window", file: "src/renderer/app/panels/ask.ts", what: "a question closes on a click outside it",
    find: "    dialog.addEventListener('close', () => {", replace: "    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });\n    dialog.addEventListener('close', () => {", tests: ["tests/e2e/window.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.css", what: "the tutorial's own Haram stays up behind a question",
    find: "body.dialog-open .tut-card img.char { visibility: hidden; }\n", replace: "", tests: ["tests/e2e/window.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.ts", what: "the caption buttons' patch stays white under the tutorial",
    find: "new MutationObserver(updateOverlay).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'open'] });", replace: "void updateOverlay;", tests: ["tests/e2e/window.e2e.ts"] },
  { module: "near-miss", file: "src/core/near-miss.ts", what: "a name two letters off guessed at",
    find: "(length <= 2 ? 0 : length <= 5 ? 1 : 2)", replace: "(length <= 2 ? 0 : 2)", tests: ["tests/core/near-miss.test.ts"] },
  { module: "near-miss", file: "src/core/near-miss.ts", what: "a tie between two names guessed at",
    find: "  return best.length === 1 ? best[0].name : null;", replace: "  return best[0].name;", tests: ["tests/core/near-miss.test.ts"] },
  { module: "window", file: "src/renderer/app/panels/registers.ts", what: "the changed register left out of view",
    find: "    if (first && !this.scrolledByStudent()) this.reveal(this.rows.get(first)!.el);", replace: "", tests: ["tests/e2e/fit.e2e.ts"] },
  { module: "window", file: "src/renderer/app/panels/registers.ts", what: "the Registers scrolled from under the student",
    find: "    if (first && !this.scrolledByStudent()) this.reveal", replace: "    if (first) this.reveal", tests: ["tests/e2e/fit.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.css", what: "the buttons lose their names before their icons",
    find: ".titlebar.noicons .toolbar .btn img { display: none; }", replace: ".titlebar.noicons .toolbar .btn .label { display: none; }", tests: ["tests/e2e/fit.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.ts", what: "the tutorial's example called Save & Assemble",
    find: "const assembleName = (short: boolean): string => (saves() && !short ? 'Save & Assemble' : 'Assemble');", replace: "const assembleName = (short: boolean): string => (!short ? 'Save & Assemble' : 'Assemble');", tests: ["tests/e2e/assemble.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.ts", what: "Save & Assemble kept in a narrow title bar",
    find: "const TITLE_STEPS = ['nokeys', 'noicons', 'short', 'onespeed', 'tighter'] as const;", replace: "const TITLE_STEPS = ['nokeys', 'noicons', 'onespeed', 'tighter'] as const;", tests: ["tests/e2e/fit.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.ts", what: "a window made wider keeps its narrow title bar",
    find: "  ?.addEventListener('geometrychange', () => fitTitlebar());", replace: "  ?.addEventListener('geometrychange', () => {});", tests: ["tests/e2e/assemble.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.ts", what: "a cancelled save hides the machine it assembled",
    find: "const machineShown = () => assembledText !== null;", replace: "const machineShown = () => assembledText !== null && !dirty;", tests: ["tests/e2e/assemble.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.ts", what: "what Ctrl+S did with the file not said after a clean assemble",
    find: "      if (runState === 'ready' && steps === 0 && saveNote) parts.push(span(saveWarn ? 'warn' : '', saveNote));\n", replace: "", tests: ["tests/e2e/assemble.e2e.ts"] },
  { module: "window", file: "src/renderer/app/panels/registers.ts", what: "the Changed tag only with the roomiest margins",
    find: "    const withTag = badgeStyle(width, COLUMNS, f, TAG, ch, all);", replace: "    const withTag = badgeStyle(width, COLUMNS, f, TAG, ch, all.slice(0, 1));", tests: ["tests/e2e/fit.e2e.ts"] },
  { module: "window", file: "src/renderer/app/panels/registers.ts", what: "the legend back in the Registers head",
    find: "    this.head = panelHead('Registers');\n", replace: "    this.head = panelHead('Registers');\n    this.head.setMeta('노란 줄은 방금 바뀐 레지스터');\n", tests: ["tests/e2e/fit.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.ts", what: "the status bar names one yellow row only",
    find: "    changedNow = [...changedKeys(before, now)];", replace: "    changedNow = [...changedKeys(before, now)].slice(0, 1);", tests: ["tests/e2e/fit.e2e.ts"] },
  { module: "columns", file: "src/renderer/app/logic/columns.ts", what: "a badge at the cost of the font's pixel",
    find: "style.scale === 1 && needed(shown, style, ch) <= width", replace: "needed(shown, style, ch) <= width", tests: ["tests/renderer/columns.test.ts"] },
  { module: "window", file: "src/renderer/app/app.ts", what: "the title bar never gives way",
    find: "  const fits = () => tools.getBoundingClientRect().right <= end() + 0.5;", replace: "  const fits = () => true;", tests: ["tests/e2e/fit.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.ts", what: "the program's name given up before the file's",
    find: "  if (longest()) return;\n  titlebar.classList.add('noapp');", replace: "  titlebar.classList.add('noapp');", tests: ["tests/e2e/fit.e2e.ts"] },
  { module: "window", file: "src/renderer/app/logic/names.ts", what: "a long name cut at its end (extension lost)",
    find: "  return `${head}…${ext}`;", replace: "  return `${head}${ext}…`;", tests: ["tests/renderer/names.test.ts"] },
  { module: "window", file: "src/renderer/app/app.ts", what: "a toolbar on the first screen",
    find: "  toolbar.hidden = !open;", replace: "  toolbar.hidden = false;", tests: ["tests/e2e/fit.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.css", what: "Korean words broken anywhere",
    find: "  word-break: keep-all;", replace: "  word-break: normal;", tests: ["tests/e2e/fit.e2e.ts"] },
  { module: "window", file: "src/renderer/app/dom.ts", what: "a word broken before its parenthesis",
    find: "p.text.replace(/([가-힣])\\(/g, '$1\\u2060(')", replace: "p.text", tests: ["tests/e2e/fit.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.ts", what: "a file name before a particle",
    find: "      body: '이 파일은 저장되어 있습니다. 편집기를 비우고 새 파일을 시작합니다.',", replace: "      body: `${file.name} 은 저장되어 있습니다. 편집기를 비우고 새 파일을 시작합니다.`,", tests: ["tests/renderer/particles.test.ts"] },
  { module: "window", file: "src/renderer/app/app.ts", what: "errors not listed under the Editor",
    find: "    asmBody.replaceChildren(errorNotice());", replace: "    asmBody.replaceChildren();", tests: ["tests/e2e/fit.e2e.ts"] },
  { module: "tutorial", file: "src/renderer/app/tutorial.ts", what: "only the targets lit, their panels dimmed",
    find: "    this.dim.setAttribute('d', path(lit));", replace: "    this.dim.setAttribute('d', path(merge(rects.list.map((r) => grow(r, 4)))));", tests: ["tests/e2e/tutorial.e2e.ts"] },
  { module: "tutorial", file: "src/renderer/app/tutorial.ts", what: "a lit panel takes clicks",
    find: "    this.block.setAttribute('d', path(merge(rects.list.map((r) => grow(r, 4)))));", replace: "    this.block.setAttribute('d', path(lit));", tests: ["tests/e2e/tutorial.e2e.ts"] },
  { module: "tutorial", file: "src/renderer/app/tutorial.ts", what: "the card kept off the lit panels (2.6.0: a toolbar step's card under the bar's middle)",
    find: "      : place(grown, size, view, keepOff) ?? place(grown, size, view)", replace: "      : place([...grown, ...lit], size, view, keepOff) ?? place([...grown, ...lit], size, view)", tests: ["tests/e2e/tutorial.e2e.ts"] },
  { module: "tutorial", file: "src/renderer/app/logic/placement.ts", what: "the card over a target",
    find: "&& targets.every((t) => !intersects(card, t, gap)) &&", replace: "&&", tests: ["tests/renderer/placement.test.ts"] },
  { module: "tutorial", file: "src/renderer/app/logic/placement.ts", what: "the card beside its target, never below or above it",
    find: "    const rows: [Side, number][] = [['below', Math.max(first.bottom + gap, view.top + margin)], ['above', first.top - gap - size.height]];", replace: "    const rows: [Side, number][] = [];", tests: ["tests/renderer/placement.test.ts"] },
  { module: "tutorial", file: "src/renderer/app/tutorial.ts", what: "step 20 points at nothing (not the line to fix)",
    find: "    targets: (t) => { const n = t.host.errorLine(); return n ? [lines(t, n)] : []; },", replace: "    targets: () => [],", tests: ["tests/e2e/tutorial.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.ts", what: "the title bar not fitted again when the font changes",
    find: "  fitTitlebar(); // the bar's words grow with the font", replace: "  // the bar's words grow with the font", tests: ["tests/e2e/titlebar.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.css", what: "the title bar's controls as tall as their words",
    find: ".titlebar .btn, .titlebar .seg { height: var(--ctl); line-height: 1; }\n", replace: "", tests: ["tests/e2e/titlebar.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.ts", what: "no step past the program's name (a big font runs off the window)",
    find: "  for (let level = 1; level <= TITLE_LAST.length; level += 1) {", replace: "  for (let level = 1; level <= 0; level += 1) {", tests: ["tests/e2e/titlebar.e2e.ts"] },
  { module: "tutorial", file: "src/renderer/app/tutorial.ts", what: "keys a step does not ask for go through",
    find: "      return allowed.has(key) ? false : take();", replace: "      return false;", tests: ["tests/e2e/tutorial.e2e.ts"] },
  { module: "tutorial", file: "src/renderer/app/tutorial.ts", what: "targets left out of view",
    find: "    if (now.reveal && (rects.missing || rects.clipped) &&", replace: "    if (false &&", tests: ["tests/e2e/tutorial.e2e.ts"] },
  { module: "tutorial", file: "src/renderer/app/tutorial.ts", what: "a practice step goes on without showing its result",
    find: "      if (STEPS[this.index].result) { if (!this.result) this.showResult(); return; }\n", replace: "", tests: ["tests/e2e/tutorial.e2e.ts"] },
  { module: "tutorial", file: "src/renderer/app/tutorial.ts", what: "Reset not seen at step 17",
    find: "    done: (_t, s) => (s.kind === 'reset' ? 'next' : null),", replace: "    done: () => null,", tests: ["tests/e2e/tutorial.e2e.ts"] },
  { module: "tutorial", file: "src/renderer/app/tutorial.ts", what: "[건너뛰기] never turns up",
    find: "this.renderCard(); }, 6000);", replace: "this.renderCard(); }, 600000);", tests: ["tests/e2e/tutorial.e2e.ts"] },
  { module: "tutorial", file: "src/renderer/app/tutorial.ts", what: "Encoding not turned on at step 9",
    find: " t.host.pin(t.addr(ADD)); t.column('text', 'word'); },", replace: " t.host.pin(t.addr(ADD)); },", tests: ["tests/e2e/tutorial.e2e.ts"] },
  { module: "tutorial", file: "src/renderer/app/tutorial.ts", what: "Haram between the card and the target",
    find: "    this.card.classList.toggle('haram-left', far === 'left');", replace: "    this.card.classList.toggle('haram-left', far !== 'left');", tests: ["tests/e2e/tutorial.e2e.ts"] },
  { module: "tutorial", file: "src/renderer/app/app.css", what: "two Harams on screen",
    find: "body.tutorial-on img.char:not(.tut-char):not(.modal img.char) { visibility: hidden; }", replace: "", tests: ["tests/e2e/tutorial.e2e.ts"] },
  { module: "tutorial", file: "src/renderer/app/app.ts", what: "the example not read-only",
    find: "  editor.setReadOnly(example !== undefined);", replace: "  editor.setReadOnly(false);", tests: ["tests/e2e/tutorial.e2e.ts"] },
  { module: "tutorial", file: "src/renderer/app/app.ts", what: "unsaved changes not put back",
    find: "      dirty = back.dirty;", replace: "", tests: ["tests/e2e/tutorial.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.css", what: "a narrow Inspector scrolls sideways",
    find: "@container (max-width: 480px) {\n  .ihead", replace: "@container (max-width: 200px) {\n  .ihead", tests: ["tests/e2e/fit.e2e.ts"] },
  { module: "first screen", file: "src/renderer/app/panels/welcome.ts", what: "each step builds its own background",
    find: "  const second = () => {\n", replace: "  const second = () => {\n    start.root.replaceWith(backdrop().root);\n", tests: ["tests/e2e/start.e2e.ts"] },
  { module: "first screen", file: "src/renderer/app/panels/backdrop.ts", what: "the video's sound back",
    find: "  clip.muted = true;\n", replace: "  clip.muted = false;\n", tests: ["tests/e2e/start.e2e.ts"] },
  { module: "first screen", file: "tools/start-video.ts", what: "the clip made with the source's sound",
    find: "'-map', '[v]', '-an',", replace: "'-map', '[v]', '-map', '0:a?',", tests: ["tests/renderer/start-clip.test.ts"] },
  { module: "first screen", file: "src/renderer/app/panels/backdrop.ts", what: "the video under prefers-reduced-motion",
    find: "if (!shown || reduce.matches ||", replace: "if (!shown ||", tests: ["tests/e2e/start.e2e.ts"] },
  { module: "first screen", file: "src/renderer/app/panels/backdrop.ts", what: "the video goes on under the Editor",
    find: "if (on !== shown) { shown = on; update(); }", replace: "if (on) { shown = on; update(); }", tests: ["tests/e2e/start.e2e.ts"] },
  { module: "first screen", file: "src/renderer/app/app.css", what: "a clip that cannot play leaves the still",
    find: ".wback.failed img, .wback.failed video,", replace: ".wback.failed video,", tests: ["tests/e2e/start.e2e.ts"] },
  { module: "first screen", file: "src/renderer/app/app.css", what: "white under the video",
    find: "pointer-events: none; background: var(--navy); }", replace: "pointer-events: none; background: var(--white); }", tests: ["tests/e2e/start.e2e.ts"] },
  { module: "first screen", file: "src/renderer/app/app.css", what: "the video untinted",
    find: ".wback::after { content: '';", replace: ".wback::after { display: none; content: '';", tests: ["tests/e2e/start.e2e.ts"] },
  { module: "first screen", file: "src/renderer/app/app.css", what: "the glass card thinner than its texts' contrast allows",
    find: "  background: rgba(255,255,255,.82); backdrop-filter:", replace: "  background: rgba(255,255,255,.65); backdrop-filter:", tests: ["tests/e2e/start.e2e.ts"] },
  { module: "first screen", file: "src/renderer/app/app.css", what: "the glass card without its blur",
    find: "backdrop-filter: blur(18px) saturate(1.2);", replace: "backdrop-filter: none;", tests: ["tests/e2e/start.e2e.ts"] },
  { module: "first screen", file: "src/renderer/app/app.css", what: "the video unblurred",
    find: "object-fit: cover; filter: blur(8px) saturate(1.25) sepia(.1) hue-rotate(-6deg);", replace: "object-fit: cover;", tests: ["tests/e2e/start.e2e.ts"] },
  { module: "first screen", file: "tools/start-video.ts", what: "the clip made with the source's copied frames (no de-duplication: 2.7.0's standstills)",
    find: "    : `${DEDUP},setpts=N/(${REAL_RATE})/TB,${scale},", replace: "    : `setpts=N/(${REAL_RATE})/TB,${scale},", tests: ["tests/renderer/start-clip.test.ts"] },
  { module: "first screen", file: "tools/start-video.ts", what: "the slowed clip without the frames in between",
    find: "minterpolate=fps=${FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1", replace: "fps=${FPS}", tests: ["tests/renderer/start-clip.test.ts"] },
  // ---- The RISC-V edition's own code.
  { module: "engine", file: "src/sim/host.ts", what: "an engine of another protocol talked to",
    find: "if (ev.protocol !== PROTOCOL) {", replace: "if (ev.protocol > PROTOCOL) {", tests: ["tests/sim/process.test.ts"] },
  { module: "engine", file: "src/sim/host.ts", what: "a crashed engine not restarted",
    find: "    this.setState('restarting', cause);\n    this.launch();", replace: "    this.setState('restarting', cause);", tests: ["tests/sim/process.test.ts"] },
  { module: "engine", file: "src/sim/host.ts", what: "an engine that keeps dying restarted for ever",
    find: "|| this.crashes.length > this.maxCrashes;", replace: "|| this.crashes.length > 1e9;", tests: ["tests/sim/process.test.ts"] },
  { module: "engine", file: "src/sim/host.ts", what: "a dead engine still called",
    find: "    if (this.state === 'dead') throw new EngineDead(this.deadReason);\n    await this.ready;", replace: "    await this.ready;", tests: ["tests/sim/process.test.ts"] },
  { module: "engine", file: "src/sim/host.ts", what: "what was pending left hanging when the engine dies",
    find: "    for (const p of this.pending.values()) p.reject(error);\n    this.pending.clear();", replace: "", tests: ["tests/sim/process.test.ts"] },
  { module: "engine", file: "src/sim/host.ts", what: "stop() never kills an engine that does not answer",
    find: "      if (answered === 'timeout') { kill(); return 'killed'; }", replace: "      if (answered === 'timeout') { return 'killed'; }", tests: ["tests/sim/process.test.ts"] },
  { module: "engine", file: "src/sim/protocol.ts", what: "the app expects protocol 1",
    find: "export const PROTOCOL = 2;", replace: "export const PROTOCOL = 1;", tests: ["tests/sim/process.test.ts"] },
  { module: "engine", file: "src/main/main.ts", what: "the restart switch inverted (SIM_RESTART)",
    find: "restartOnCrash: process.env.SIM_RESTART !== '0'", replace: "restartOnCrash: process.env.SIM_RESTART === '1'", tests: ["tests/e2e/firstlight.e2e.ts"] },
  { module: "engine", file: "src/renderer/app/app.ts", what: "a crash not said in the status bar",
    find: "  crashNote = restarted ? `${message} (${cause}) — 엔진을 다시 시작했습니다. 다시 어셈블하세요 (Ctrl+S)` : `${message} (${cause})`;", replace: "  crashNote = '';", tests: ["tests/e2e/firstlight.e2e.ts"] },
  { module: "engine", file: "src/renderer/app/app.ts", what: "a cancelled input wait not said",
    find: "    if (result.input_cancelled) note = result.undone", replace: "    if (false) note = result.undone", tests: ["tests/e2e/firstlight.e2e.ts"] },
  { module: "decoder", file: "src/core/decoder.ts", what: "a store formatted as B",
    find: "    case 0x23: case 0x27: return 'S';", replace: "    case 0x23: case 0x27: return 'B';", tests: ["tests/core/decoder.test.ts"] },
  { module: "decoder", file: "src/core/decoder.ts", what: "sub named add",
    find: "'32,0': 'sub'", replace: "'32,0': 'add'", tests: ["tests/core/decoder.test.ts"] },
  { module: "decoder", file: "src/core/decoder.ts", what: "blt and bge swapped",
    find: "4: 'blt', 5: 'bge'", replace: "4: 'bge', 5: 'blt'", tests: ["tests/core/decoder.test.ts"] },
  { module: "decoder", file: "src/core/decoder.ts", what: "B's imm[11] taken from bit 8",
    find: "['imm[4:1|11]', 7, 7, 11, 11]", replace: "['imm[4:1|11]', 8, 8, 11, 11]", tests: ["tests/core/decoder.test.ts"] },
  { module: "decoder", file: "src/core/decoder.ts", what: "J's imm[11] and imm[20] swapped",
    find: "['imm[20|10:1|11|19:12]', 20, 20, 11, 11]", replace: "['imm[20|10:1|11|19:12]', 31, 31, 11, 11]", tests: ["tests/core/decoder.test.ts"] },
  { module: "decoder", file: "src/core/decoder.ts", what: "S's low piece one bit up",
    find: "['imm[4:0]', 11, 7, 4, 0]", replace: "['imm[4:0]', 11, 7, 5, 1]", tests: ["tests/core/decoder.test.ts"] },
  { module: "decoder", file: "src/core/decoder.ts", what: "U sign-extended",
    find: "  const signExtended = format !== 'U';", replace: "  const signExtended = true;", tests: ["tests/core/decoder.test.ts"] },
  { module: "decoder", file: "src/core/decoder.ts", what: "J's formula without bit 11",
    find: "(bits(word, 20, 20) << 11) | (bits(word, 30, 21) << 1), 21);", replace: "(bits(word, 30, 21) << 1), 21);", tests: ["tests/core/decoder.test.ts"] },
  { module: "decoder", file: "src/core/decoder.ts", what: "B's fields not tiling the word",
    find: "field('imm[4:1|11]', 11, 7, w)", replace: "field('imm[4:1|11]', 11, 8, w)", tests: ["tests/core/decoder.test.ts"] },
  { module: "decoder", file: "src/core/decoder.ts", what: "a shift immediate read as imm[11:0]",
    find: "const isShiftImmediate = (word: number) => (word & 0x7f) === 0x13 && (bits(word, 14, 12) === 1 || bits(word, 14, 12) === 5);", replace: "const isShiftImmediate = (_word: number) => false;", tests: ["tests/core/decoder.test.ts"] },
  { module: "registers", file: "src/core/registers.ts", what: "s0 and s1 swapped",
    find: "  's0', 's1', 'a0',", replace: "  's1', 's0', 'a0',", tests: ["tests/core/registers.test.ts"] },
  { module: "registers", file: "src/core/registers.ts", what: "x8 without its second name fp",
    find: "`x${n} (${n === 8 ? 's0/fp' : ABI_NAMES[n]})`", replace: "`x${n} (${ABI_NAMES[n]})`", tests: ["tests/core/registers.test.ts"] },
  { module: "registers", file: "src/core/registers.ts", what: "t6 left out of the Temporaries",
    find: "[...range(5, 7), ...range(28, 31)]", replace: "[...range(5, 7), ...range(28, 30)]", tests: ["tests/core/registers.test.ts"] },
  { module: "registers", file: "src/core/registers.ts", what: "x32 accepted",
    find: "  if (m && Number(m[1]) < 32) return { file: 'x', number: Number(m[1]) };", replace: "  if (m && Number(m[1]) < 33) return { file: 'x', number: Number(m[1]) };", tests: ["tests/core/registers.test.ts"] },
  { module: "registers", file: "src/renderer/app/logic/machine.ts", what: "an f register read as its low 32 bits only",
    find: "  if (hi === 0xffffffff) {", replace: "  if (true) {", tests: ["tests/renderer/logic.test.ts"] },
  { module: "registers", file: "src/renderer/app/logic/machine.ts", what: "a NaN-boxed single read as a double",
    find: "  if (hi === 0xffffffff) {", replace: "  if (false) {", tests: ["tests/renderer/logic.test.ts"] },
  { module: "inspector", file: "src/renderer/app/panels/inspector.ts", what: "the sign extension filled with 0",
    find: "  const sign = (p.value >>> (p.width - 1)) & 1;", replace: "  const sign = 0;", tests: ["tests/e2e/inspector-formats.e2e.ts"] },
  { module: "inspector", file: "src/renderer/app/panels/inspector.ts", what: "the always-0 bits left out of the row",
    find: "  if (p.zeros > 0) cells.push(", replace: "  if (p.zeros > 1) cells.push(", tests: ["tests/e2e/inspector-formats.e2e.ts"] },
  { module: "inspector", file: "src/renderer/app/panels/inspector.ts", what: "the word's immediate bits not coloured by piece",
    find: "            const k = parts && f.cls === 'f-imm' ? pieceAt(f.high - i) : 0;", replace: "            const k = 0;", tests: ["tests/e2e/inspector-formats.e2e.ts"] },
  { module: "inspector", file: "src/renderer/app/panels/inspector.ts", what: "the pieces in the word's order, not the immediate's",
    find: "  p.pieces.forEach((piece, i) => {", replace: "  [...p.pieces].sort((a, b) => b.wordHigh - a.wordHigh).forEach((piece, i) => {", tests: ["tests/e2e/inspector-formats.e2e.ts"] },
  { module: "inspector", file: "src/core/instruction-text.ts", what: "B's stated immediate off by two",
    find: "    case 'B': return `imm = 0b${raw} = ${p.value} (13비트", replace: "    case 'B': return `imm = 0b${raw} = ${p.value + 2} (13비트", tests: ["tests/e2e/inspector-formats.e2e.ts"] },
  { module: "near-miss", file: "src/core/near-miss.ts", what: "syscall's RISC-V name wrong",
    find: "syscall: 'ecall'", replace: "syscall: 'call'", tests: ["tests/core/near-miss.test.ts"] },
  { module: "near-miss", file: "src/core/near-miss.ts", what: "t7 taken for a register",
    find: "['t', 0, 6]", replace: "['t', 0, 7]", tests: ["tests/core/near-miss.test.ts"] },
  { module: "near-miss", file: "src/core/near-miss.ts", what: "a bare word guessed at as a register without RARS naming it",
    find: "    if (w === flagged) {", replace: "    if (true) {", tests: ["tests/core/near-miss.test.ts"] },
  { module: "near-miss", file: "src/core/near-miss.ts", what: "a $ register taken as it is",
    find: "    if (w.startsWith('$')) {", replace: "    if (w.startsWith('%')) {", tests: ["tests/core/near-miss.test.ts"] },
  { module: "near-miss", file: "src/renderer/app/app.ts", what: "the hint not shown under the error",
    find: "    const hint = source ? hintFor(e.message, source) : '';", replace: "    const hint = '';", tests: ["tests/e2e/editor.e2e.ts"] },
  { module: "near-miss", file: "src/renderer/app/app.ts", what: "the word RARS names not passed to the guess",
    find: "  const flagged = /^\"([^\"]+)\"/.exec(message)?.[1] ?? null;", replace: "  const flagged = null;", tests: ["tests/e2e/editor.e2e.ts"] },
  { module: "window", file: "src/renderer/app/app.ts", what: "a file opened while an assemble is on its way (the late answer wins)",
    find: "  for (let i = 0; i < 500 && busy; i += 1) await new Promise((r) => setTimeout(r, 20));", replace: "", tests: ["tests/e2e/flows.e2e.ts"] },
  { module: "tutorial", file: "src/renderer/app/tutorial.ts", what: "step 5 points at the wrong line (sub for add)",
    find: "const ADD = /^\\s+add\\s+t3, t1, t2/;", replace: "const ADD = /^\\s+sub\\s+t4/;", tests: ["tests/e2e/tutorial.e2e.ts"] },
  { module: "tutorial", file: "src/renderer/app/tutorial.ts", what: "step 9 rings the MIPS fields",
    find: "...['funct7', 'rs2', 'rs1', 'funct3', 'rd', 'opcode'].map(", replace: "...['opcode', 'rs', 'rt', 'rd'].map(", tests: ["tests/e2e/tutorial.e2e.ts"] },
];

function copyTree(dir: string, _linkBuild: boolean): void {
  for (const d of ['src', 'tests', 'tools']) cpSync(path.join(root, d), path.join(dir, d), { recursive: true });
  for (const f of ['package.json', 'tsconfig.json', 'playwright.config.ts']) cpSync(path.join(root, f), path.join(dir, f));
  cpSync(path.join(root, '..', 'NOTICE'), path.join(dir, '..', 'NOTICE')); // the repository's (About lists it)
  symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
  // The engine's classes (probe/build/classes), beside the copy as probe/ is beside electron/.
  symlinkSync(path.join(root, '..', 'probe'), path.join(dir, '..', 'probe'));
}

// ---- which mutants ------------------------------------------------------------------------

const repo = path.join(root, '..');
const BASELINE = path.join(root, 'tools/mutants-baseline.json');
const keyOf = (m: Mutant): string => `${m.module}: ${m.what}`;

interface Baseline { sha: string; date: string; killed: number; run?: string; mutants: string[] }

// Every mutant's `find` exactly once in its `file` (text only): the mutants
// that do not apply any more, with how often their text occurs.
function staleFinds(dir: string): { m: Mutant; count: number }[] {
  const out: { m: Mutant; count: number }[] = [];
  for (const m of MUTANTS) {
    const file = path.join(dir, m.file);
    const count = existsSync(file) ? readFileSync(file, 'utf8').split(m.find).length - 1 : 0;
    if (count !== 1) out.push({ m, count });
  }
  return out;
}

// The repository's paths changed since `sha`: committed, staged, unstaged,
// untracked.  git status -z gives "XY path\0", and for a rename or copy
// "XY new\0old\0": both paths count.
function changedSince(repoDir: string, sha: string): Set<string> {
  const git = (args: string[]) => execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const files = new Set<string>();
  for (const f of git(['diff', '--name-only', '-z', `${sha}..HEAD`]).split('\0')) if (f) files.add(f);
  const records = git(['status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0');
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!r) continue;
    files.add(r.slice(3));
    if (r[0] === 'R' || r[0] === 'C') { i += 1; if (records[i]) files.add(records[i]); }
  }
  return files;
}

interface Picked { m: Mutant; why: string[] }
type Selection =
  | { all: true; reason: string }
  | { all: false; baseline: Baseline; changed: Set<string>; run: Picked[]; skipped: Mutant[] };

// What --changed runs, from the baseline at `baselineFile` and the changes in
// `repoDir` (whose electron/ holds the mutants' files).  Any doubt: all of them.
function select(repoDir: string, baselineFile: string): Selection {
  const electronDir = path.join(repoDir, 'electron');
  let baseline: Baseline;
  try {
    baseline = JSON.parse(readFileSync(baselineFile, 'utf8')) as Baseline;
  } catch (e) {
    return { all: true, reason: `no baseline to go from (${path.relative(repo, baselineFile)}: ${(e as Error).message})` };
  }
  if (!/^[0-9a-f]{40}$/.test(baseline.sha ?? '') || !Array.isArray(baseline.mutants)) {
    return { all: true, reason: `${path.relative(repo, baselineFile)} has no commit or no list of mutants` };
  }
  try {
    execFileSync('git', ['-C', repoDir, 'merge-base', '--is-ancestor', baseline.sha, 'HEAD'], { stdio: 'ignore' });
  } catch {
    return { all: true, reason: `the baseline commit ${baseline.sha.slice(0, 7)} is not an ancestor of HEAD` };
  }
  let changed: Set<string>;
  try {
    changed = changedSince(repoDir, baseline.sha);
  } catch (e) {
    return { all: true, reason: `git did not give the changes since ${baseline.sha.slice(0, 7)}: ${(e as Error).message.split('\n')[0]}` };
  }
  for (const m of MUTANTS) {
    for (const f of [m.file, ...m.tests]) {
      if (!existsSync(path.join(electronDir, f))) return { all: true, reason: `${keyOf(m)}: ${f} does not exist` };
    }
  }
  const known = new Set(baseline.mutants);
  const run: Picked[] = [], skipped: Mutant[] = [];
  for (const m of MUTANTS) {
    const why: string[] = [];
    if (!known.has(keyOf(m))) why.push('new since the baseline');
    if (changed.has(`electron/${m.file}`)) why.push(`file ${m.file} changed`);
    for (const t of m.tests) if (changed.has(`electron/${t}`)) why.push(`test ${t} changed`);
    if (why.length) run.push({ m, why }); else skipped.push(m);
  }
  return { all: false, baseline, changed, run, skipped };
}

// ---- running them ----------------------------------------------------------------------------

interface Result { key: string; module: string; what: string; rebuild: boolean; result: 'killed' | 'survived' | 'not applied' | 'error'; seconds: number; by: string }

function run(cmd: string, args: string[], cwd: string, timeout: number): Promise<{ status: number | null; stdout: string }> {
  return new Promise((done) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', () => {});
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.on('close', (status) => { clearTimeout(timer); done({ status, stdout }); });
  });
}

// The command for tests of one kind (all *.e2e.ts, or none); e2e ones on
// their own display when this is Linux and there is none, or more than one
// worker runs.
function testCommand(tests: string[], display: number | null): [string, string[]] {
  const e2e = tests[0].endsWith('.e2e.ts');
  const args = e2e
    ? [path.join(root, 'node_modules/@playwright/test/cli.js'), 'test', ...tests]
    : ['--test', '--import', './tests/helpers/timer-at-exit.ts', '--test-reporter=tap', ...tests];
  if (e2e && display !== null) return ['xvfb-run', ['-n', String(display), '-s', '-screen 0 2400x1400x24', process.execPath, ...args]];
  return [process.execPath, args];
}

async function runOne(m: Mutant, display: number | null): Promise<Result> {
  const started = Date.now();
  const result = (r: Result['result'], by: string): Result =>
    ({ key: keyOf(m), module: m.module, what: m.what, rebuild: !!m.rebuild, result: r, seconds: Math.round((Date.now() - started) / 100) / 10, by });
  const outer = mkdtempSync(path.join(os.tmpdir(), 'mutant-'));
  const dir = path.join(outer, 'electron');
  mkdirSync(dir);
  try {
    copyTree(dir, !m.rebuild);
    const file = path.join(dir, m.file);
    const text = readFileSync(file, 'utf8');
    const count = text.split(m.find).length - 1;
    if (count !== 1) return result('not applied', `found ${count} times`);
    writeFileSync(file, text.replace(m.find, m.replace));
    if (m.rebuild) {
      const b = await run(path.join(root, 'node_modules/.bin/node-gyp'), ['rebuild', '--directory', path.join(dir, 'native')], dir, 900000);
      if (b.status !== 0) return result('error', 'the addon did not build');
    }
    // Unit tests (node --test) first, then e2e ones (Playwright): a list may name both.
    const unit = m.tests.filter((t) => !t.endsWith('.e2e.ts')), e2e = m.tests.filter((t) => t.endsWith('.e2e.ts'));
    if (e2e.length) {
      const b = await run(process.execPath, ['tools/build-ui.ts'], dir, 120000);
      if (b.status !== 0) return result('error', 'the window script did not bundle');
    }
    for (const tests of [unit, e2e]) {
      if (!tests.length) continue;
      const isE2e = tests === e2e;
      const [cmd, args] = testCommand(tests, isE2e ? display : null);
      const t = await run(cmd, args, dir, 300000);
      if (t.status !== 0) {
        const first = (isE2e ? /^\s*\d+\) (.*)$/m.exec(t.stdout)?.[1]?.replace(/─+$/, '').trim()
                             : /^\s*not ok \d+ - (.*)$/m.exec(t.stdout)?.[1]) ?? '(no test reported a failure)';
        return result('killed', first);
      }
    }
    return result('survived', '');
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
}

// The selection's tests with no mutant: they must pass, or a kill says nothing.
async function control(list: Mutant[], display: number | null): Promise<string | null> {
  const unit = [...new Set(list.flatMap((m) => m.tests).filter((t) => !t.endsWith('.e2e.ts')))];
  const e2e = [...new Set(list.flatMap((m) => m.tests).filter((t) => t.endsWith('.e2e.ts')))];
  const outer = mkdtempSync(path.join(os.tmpdir(), 'mutant-control-'));
  const dir = path.join(outer, 'electron');
  mkdirSync(dir);
  try {
    copyTree(dir, true);
    for (const tests of [unit, e2e]) {
      if (!tests.length) continue;
      if (tests === e2e) await run(process.execPath, ['tools/build-ui.ts'], dir, 120000);
      const [cmd, args] = testCommand(tests, tests === e2e ? display : null);
      const t = await run(cmd, args, dir, 3600000);
      if (t.status !== 0) {
        const first = (/^\s*\d+\) (.*)$/m.exec(t.stdout)?.[1] ?? /^\s*not ok \d+ - (.*)$/m.exec(t.stdout)?.[1] ?? '').trim();
        return `${tests.length} test file(s) fail with no mutant${first ? `: ${first}` : ''}`;
      }
    }
    return null;
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
}

// `jobs` at a time; those that rebuild the addon one at a time, after.
async function runAll(list: Mutant[], jobs: number, displays: boolean): Promise<Result[]> {
  const results: Result[] = [];
  const say = (r: Result) => console.log(`${r.result.padEnd(12)} ${r.key}${r.by ? `  <-  ${r.by}` : ''}  (${r.seconds} s)`);
  const pool = async (items: Mutant[], width: number) => {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(width, items.length) }, async (_, w) => {
      for (let i = next++; i < items.length; i = next++) {
        const r = await runOne(items[i], displays ? 120 + w : null);
        results.push(r);
        say(r);
      }
    }));
  };
  await pool(list.filter((m) => !m.rebuild), jobs);
  await pool(list.filter((m) => m.rebuild), 1);
  const order = new Map(list.map((m, i) => [keyOf(m), i]));
  return results.sort((a, b) => order.get(a.key)! - order.get(b.key)!);
}

// ---- the selector's own checks ------------------------------------------------------------

// In a temporary worktree of HEAD (removed after; nothing in this tree is
// touched): the baseline HEAD itself picks nothing; a blank line added to one
// mutant's file picks exactly the mutants that name that file; a blank line
// added to a test file that is no mutant's `file` (the one running most
// mutants on other files) picks exactly those that run it.
function verifySelector(): boolean {
  const wt = mkdtempSync(path.join(os.tmpdir(), 'mutants-selector-'));
  let ok = true;
  const check = (what: string, got: Selection, want: Mutant[]) => {
    if (got.all) { console.log(`FAIL  ${what}: fell back to all (${got.reason})`); ok = false; return; }
    const g = got.run.map((p) => keyOf(p.m)).sort(), w = want.map(keyOf).sort();
    const same = g.length === w.length && g.every((k, i) => k === w[i]);
    console.log(`${same ? 'PASS' : 'FAIL'}  ${what}: picked ${g.length}${g.length ? `:\n        ${g.join('\n        ')}` : ''}`);
    if (!same) { console.log(`      expected ${w.length}: ${w.join('; ')}`); ok = false; }
  };
  try {
    execFileSync('git', ['-C', repo, 'worktree', 'add', '--detach', wt, 'HEAD'], { stdio: 'ignore' });
    const head = execFileSync('git', ['-C', wt, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const base = path.join(os.tmpdir(), `mutants-baseline-${process.pid}.json`); // outside the worktree: not a change
    writeFileSync(base, JSON.stringify({ sha: head, date: new Date().toISOString(), killed: MUTANTS.length, mutants: MUTANTS.map(keyOf) }));
    check('1. the baseline commit itself, nothing changed', select(wt, base), []);
    const target = MUTANTS[0].file;                        // src/core/decoder.ts
    const f = path.join(wt, 'electron', target);
    writeFileSync(f, readFileSync(f, 'utf8') + '\n');
    check(`2. a blank line added to ${target}`, select(wt, base), MUTANTS.filter((m) => m.file === target || m.tests.includes(target)));
    execFileSync('git', ['-C', wt, 'checkout', '--', `electron/${target}`]);
    // The test file that is no mutant's `file` and runs the most mutants on other files than check 2's.
    const files = new Set(MUTANTS.map((m) => m.file));
    const uses = new Map<string, number>();
    for (const m of MUTANTS) if (m.file !== target) for (const t of m.tests) if (!files.has(t)) uses.set(t, (uses.get(t) ?? 0) + 1);
    const test = [...uses].sort((a, b) => b[1] - a[1])[0][0];
    const t = path.join(wt, 'electron', test);
    writeFileSync(t, readFileSync(t, 'utf8') + '\n');
    check(`3. a blank line added to ${test} (a test file only)`, select(wt, base), MUTANTS.filter((m) => m.tests.includes(test)));
    rmSync(base, { force: true });
  } finally {
    execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', wt], { stdio: 'ignore' });
  }
  return ok;
}

// ---- the command line -------------------------------------------------------------------

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  allowNegative: true, // --no-control
  options: {
    changed: { type: 'boolean', default: false },
    list: { type: 'boolean', default: false },
    check: { type: 'boolean', default: false },
    control: { type: 'boolean', default: true },
    jobs: { type: 'string' },
    shard: { type: 'string' },
    json: { type: 'string' },
    merge: { type: 'string' },
    'baseline-from': { type: 'string' },
    run: { type: 'string' },
    'verify-selector': { type: 'boolean', default: false },
  },
});

if (opt['verify-selector']) process.exit(verifySelector() ? 0 : 1);

if (opt.merge) {
  // --merge OUT IN...: every mutant exactly once, and killed.
  const parts = positionals.map((f) => JSON.parse(readFileSync(f, 'utf8')) as { sha: string; results: Result[] });
  const all = parts.flatMap((p) => p.results);
  const shas = new Set(parts.map((p) => p.sha));
  const seen = new Map<string, number>();
  for (const r of all) seen.set(r.key, (seen.get(r.key) ?? 0) + 1);
  const missing = MUTANTS.map(keyOf).filter((k) => !seen.has(k));
  const twice = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
  const notKilled = all.filter((r) => r.result !== 'killed');
  const merged = { sha: [...shas].join(','), date: new Date().toISOString(), total: MUTANTS.length, killed: all.filter((r) => r.result === 'killed').length,
                   seconds: Math.round(all.reduce((n, r) => n + r.seconds, 0)), results: all };
  writeFileSync(opt.merge, JSON.stringify(merged, null, 1));
  const lines = [`## Mutants: ${merged.killed} of ${MUTANTS.length} killed`, '', `commit ${merged.sha}; ${parts.length} shard(s); ${merged.seconds} s of mutant time`, '',
    '| Mutant | Result | Seconds | Killed by |', '|---|---|---|---|',
    ...all.map((r) => `| ${r.key.replace(/\|/g, '\\|')} | ${r.result} | ${r.seconds} | ${r.by.replace(/\|/g, '\\|').slice(0, 120)} |`)];
  console.log(lines.join('\n'));
  const bad = [shas.size !== 1 ? `the shards ran on different commits: ${[...shas].join(', ')}` : '',
    missing.length ? `not run: ${missing.join('; ')}` : '', twice.length ? `run twice: ${twice.join('; ')}` : '',
    notKilled.length ? `not killed: ${notKilled.map((r) => `${r.key} (${r.result})`).join('; ')}` : ''].filter(Boolean);
  for (const b of bad) console.error(`FAIL  ${b}`);
  process.exit(bad.length ? 1 : 0);
}

if (opt['baseline-from']) {
  // A green, complete full pass -> the baseline record, printed (committed by hand).
  const merged = JSON.parse(readFileSync(opt['baseline-from'], 'utf8')) as { sha: string; results: Result[] };
  const killed = merged.results.filter((r) => r.result === 'killed').map((r) => r.key);
  const missing = MUTANTS.map(keyOf).filter((k) => !killed.includes(k));
  if (!/^[0-9a-f]{40}$/.test(merged.sha) || missing.length) {
    console.error(`not a baseline: ${missing.length ? `not killed there: ${missing.join('; ')}` : `commit ${merged.sha}`}`);
    process.exit(1);
  }
  const date = execFileSync('git', ['-C', repo, 'show', '-s', '--format=%cI', merged.sha], { encoding: 'utf8' }).trim();
  console.log(JSON.stringify({ sha: merged.sha, date, killed: killed.length, run: opt.run, mutants: killed.sort() }, null, 1));
  process.exit(0);
}

// --check, and before every run: a mutant that no longer applies stops everything.
const stale = staleFinds(root);
for (const { m, count } of stale) console.error(`STALE        ${keyOf(m)}: its find occurs ${count} times in ${m.file}`);
console.log(`find: ${MUTANTS.length - stale.length} of ${MUTANTS.length} mutants apply (their text once in their file)`);
if (stale.length) process.exit(1);
if (opt.check) process.exit(0);

let list = MUTANTS.filter((m) => `${m.module} ${m.what}`.includes(positionals[0] ?? ''));
if (!list.length) { console.error(`no mutant's "module what" holds "${positionals[0]}"`); process.exit(1); }
if (opt.changed) {
  const sel = select(repo, BASELINE);
  if (sel.all) {
    console.log(`ALL          ${sel.reason}: every mutant runs`);
  } else {
    const b = sel.baseline;
    console.log(`baseline     ${b.sha} (${b.date}; ${b.killed} killed${b.run ? `; ${b.run}` : ''})`);
    console.log(`changes      ${sel.changed.size} files since then (committed, staged, unstaged, untracked)`);
    console.log(`to run       ${sel.run.length}`);
    for (const p of sel.run) console.log(`  run        ${keyOf(p.m)}  <-  ${p.why.join('; ')}`);
    console.log(`skipped      ${sel.skipped.length}: file and tests unchanged since ${b.sha.slice(0, 7)}, killed there`);
    for (const m of sel.skipped) console.log(`  skip       ${keyOf(m)}  (${[m.file, ...m.tests].join(', ')})`);
    // Checked again, now, against the same change set: a skipped mutant with a changed file is a bug here.
    const leak = sel.skipped.filter((m) => [m.file, ...m.tests].some((f) => sel.changed.has(`electron/${f}`)));
    if (leak.length) {
      for (const m of leak) console.error(`FAIL         skipped although changed: ${keyOf(m)}`);
      process.exit(1);
    }
    console.log(`PASS         no skipped mutant has its file or a test among the ${sel.changed.size} changed files`);
    const chosen = new Set(sel.run.map((p) => p.m));
    list = list.filter((m) => chosen.has(m));
  }
}
if (opt.shard) {
  const [i, n] = opt.shard.split('/').map(Number);
  if (!(n >= 1 && i >= 1 && i <= n)) throw new Error(`--shard ${opt.shard}: I/N with 1 <= I <= N`);
  // Round-robin, the addon-rebuilding ones apart, so each part gets its share of both.
  const deal = (xs: Mutant[]) => xs.filter((_, k) => k % n === i - 1);
  list = [...deal(list.filter((m) => !m.rebuild)), ...deal(list.filter((m) => m.rebuild))];
  console.log(`shard        ${i}/${n}: ${list.length} mutants`);
}

if (opt.list) {
  for (const m of list) console.log(`  would run  ${keyOf(m)}`);
  console.log(`${list.length} would run`);
  process.exit(0);
}
const jobs = opt.jobs ? Number(opt.jobs) : Math.max(1, Math.min(6, Math.floor(os.cpus().length / 3)));
const displays = process.platform === 'linux' && (jobs > 1 || !process.env.DISPLAY);
console.log(`running      ${list.length} mutants, ${jobs} at a time${displays ? ' (each on its own display)' : ''}`);
const started = Date.now();
if (opt.control && list.length) {
  const bad = await control(list, displays ? 119 : null);
  if (bad) { console.error(`CONTROL      ${bad}: no kill would mean anything`); process.exit(1); }
  console.log('control      the selection\'s tests pass with no mutant');
}
const results = await runAll(list, jobs, displays);
const head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (opt.json) writeFileSync(opt.json, JSON.stringify({ sha: head, shard: opt.shard ?? null, results }, null, 1));
const killed = results.filter((r) => r.result === 'killed').length;
console.log(`\n${killed} of ${results.length} mutants killed (${Math.round((Date.now() - started) / 1000)} s)`);
process.exit(killed === results.length ? 0 : 1);
