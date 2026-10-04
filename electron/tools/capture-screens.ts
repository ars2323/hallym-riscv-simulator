/* The fixed set of screenshots (docs/screens/README.md), every one of them
   taken here -- none by hand -- and all of them again every round:

     xvfb-run -a -s '-screen 0 2400x1400x24' npm run screens

   The examples and step counts are written below, so a round's shots can
   be laid over the last round's.  The whole window at 1280x800 unless the
   name says otherwise; no mouse cursor, hover or tooltip in any of them
   (the pointer is moved out of the window and checked).  Each is a WebP
   (tools/webp.ts): the window's screens lossless, the first screen lossy --
   thin bright lines on a dark ground, which JPEG does worst.  Whole windows
   within 400 KB, crops within 150 KB (tests/docs/pictures.test.ts holds every
   picture of the documents to it).

   A picture whose pixels did not change is not written again, so a
   retake leaves in git only the screens that changed.  "Did not change":
   the same size, at most 20 pixels more than 2 levels from the file on
   disk and none more than 24 -- the renderer's anti-aliasing noise (seen:
   one pixel, 3 levels); a real change moves hundreds of pixels by far more
   (the clock's digits: about 300, by 100 and more).  For that the window's
   clock is fixed (FIXED_TIME): the Assemble panel and the band show the
   time of the assemble.

   windows-frame.webp: only on Windows (the CI job, with the installed app),
   the whole screen with the window maximised -- the caption buttons are the
   system's and a page capture has none.

   The first screen has the circuit board behind it
   (src/renderer/startfield/): those shots put its opening at a fixed
   moment, which is the same picture every round because the board is
   settled by its seed and the window alone.  start-frame-1, start and
   start-frame-3 are three moments of it; start-<width> and start-2-<width>
   the two steps at the other widths.

   The user guide's three pictures (docs/usage/usage.ko.md)
   are taken with the set and written to docs/usage/images/: the start
   screen, tutorial step 4, and the running window with each part named
   (the names drawn over the page for the picture only).

   SCREENS_OUT: write somewhere else (the Windows CI job: report/screens;
   the guide's pictures to report/screens/usage). */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { launch as launchApp, openAndAssemble, openOnly, program, root, sample, settled, textRow, type Running } from '../tests/e2e/harness.ts';
import { mime, pixels, toWebp, type Quality } from './webp.ts';

// Every window of the set with the same clock (the assembled time on screen).
const FIXED_TIME = new Date('2026-09-28T10:00:00+09:00');
async function launch(...args: Parameters<typeof launchApp>): Promise<Running> {
  const r = await launchApp(...args);
  await r.page.clock.setFixedTime(FIXED_TIME);
  return r;
}

const out = process.env.SCREENS_OUT ? path.resolve(process.env.SCREENS_OUT) : path.join(root, 'docs/screens');
mkdirSync(out, { recursive: true });
const guide = process.env.SCREENS_OUT ? path.join(out, 'usage') : path.join(root, '..', 'docs', 'usage', 'images');
mkdirSync(guide, { recursive: true });

const LAB04 = 'tests/samples/lab04-ok.s';     // shown as lab04.s
const LAB04_STEPS = 12;                         // PC 0x00400030, s1 (x9) just changed by srli
const PINNED = '0x00400030';                    // srai s2, t6, 1
const ERROR = 'tests/samples/lab04.s';          // line 15: srll
const DATA = 'tests/samples/data-labels.s';
const DATA_STEPS = 14;                          // past the sw onto the stack
const TYPO = '        .text\nmain:   li      a7, 10\n        syscall                 # MIPS: ecall in RISC-V\n';
const FORMATS = `.data
v:  .word 0
.text
main:
    nop
    add  t1, t0, t0
    addi t2, t1, -5
    lui  t0, 0x10010
    sw   t2, -8(t0)
    bne  t2, zero, next
    nop
next:
    jal  ra, fun
    li   a7, 10
    ecall
fun:
    ret
`;
const MAX_BYTES = 400 * 1024;      // tests/docs/pictures.test.ts: the same caps for every picture of the documents
const MAX_CROP_BYTES = 150 * 1024;
/* The first screen, lossy: the board the program draws is a field of thin
   bright lines on a dark ground, which JPEG does worst (the MIPS edition
   went from quality 85 to 78 to stay under 250 KB); WebP holds them. */
const PHOTO_QUALITY = 0.85;
const START_AT = 12.0;              // the board settled: it grows for about 8.5 s (startfield/)

// The same picture, noise aside (see above; both decoded by the page).
async function samePicture(r: Running, a: string, b: string): Promise<boolean> {
  const p = await pixels(r, readFileSync(a), mime(a)), q = await pixels(r, readFileSync(b), mime(b));
  if (p.width !== q.width || p.height !== q.height) return false;
  let noisy = 0;
  for (let i = 0; i < p.data.length; i += 4) {
    const d = Math.max(Math.abs(p.data[i] - q.data[i]), Math.abs(p.data[i + 1] - q.data[i + 1]), Math.abs(p.data[i + 2] - q.data[i + 2]));
    if (d > 24) return false;
    if (d > 2 && ++noisy > 20) return false;
  }
  return true;
}
// A capture (PNG bytes) becomes `file` as WebP, unless `file` already holds the same picture.
async function settle(r: Running, png: Buffer, file: string, max: number, quality: Quality): Promise<void> {
  const webp = await toWebp(r, png, quality);
  if (webp.length > max) throw new Error(`${path.basename(file)} is ${webp.length} bytes, over ${max}: crop it`);
  const fresh = freshName(file);
  writeFileSync(fresh, webp);
  if (existsSync(file) && await samePicture(r, fresh, file)) {
    unlinkSync(fresh);
    console.log(`same     ${path.relative(root, file)}`);
    return;
  }
  renameSync(fresh, file);
  console.log(`wrote    ${path.relative(root, file)} (${Math.round(webp.length / 1024)} KB)`);
}
const freshName = (file: string) => file.replace(/(\.\w+)$/, '.new$1');

async function still(r: Running, name: string): Promise<void> {
  const { page } = r;
  await page.mouse.move(-10, -10); // out of the window: no hover, no tooltip
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.evaluate(() => document.fonts.ready);
  await layoutSettled(r);
  await page.waitForTimeout(1100); // past the registers' flash
  const hovered = await page.evaluate(() => document.querySelectorAll(':hover').length);
  if (hovered) throw new Error(`${name}: ${hovered} elements still hovered`);
}
/* The window laid out for what just changed before a key moves the Editor:
   as built() waits for the board (tests/e2e/start.e2e.ts).  The error list
   coming in shrinks the Editor, and CodeMirror measures that a frame or more
   later; a Ctrl+Home before then left the Editor at 29 px in one take and 31
   in the next (measured), and the picture was rewritten every round.  With
   it, both takes end at 3 px.  Also before every picture (still()). */
async function layoutSettled(r: Running): Promise<void> {
  await r.page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  await r.page.waitForTimeout(500);
}
async function shot(r: Running, name: string, clip?: { x: number; y: number; width: number; height: number }): Promise<void> {
  await still(r, name);
  const file = path.join(out, `${name}.webp`);
  await settle(r, await r.page.screenshot({ clip }), file, clip ? MAX_CROP_BYTES : MAX_BYTES, 'lossless');
}
// The first screen's board: lossy WebP.
async function photo(r: Running, name: string): Promise<void> {
  await still(r, name);
  const file = path.join(out, `${name}.webp`);
  await settle(r, await r.page.screenshot(), file, MAX_BYTES, PHOTO_QUALITY);
}
// The first screen's board (src/renderer/startfield/), put at `t` seconds
// of its opening -- the same picture every round, with no clip to seek.
async function boardAt(r: Running, t: number): Promise<void> {
  await r.page.waitForSelector('.startfield canvas');
  /* The board is grown after the fonts are ready, which is a frame or two
     after the canvas is in the document.  Stepping the clock before then
     drew nothing and left the loop running, and the picture was then of
     whatever moment the shot happened to catch: that is what rewrote two to
     seven of these on every capture, for rounds. */
  await r.page.waitForFunction(() => (window as unknown as {
    __startfield: { geometry(): unknown } }).__startfield.geometry() !== undefined);
  // The window settling its size sets the board off again (a ResizeObserver
  // behind a 180 ms debounce), which would start the clock over after the
  // moment was put where it was wanted.
  await r.page.waitForTimeout(400);
  await r.page.evaluate((t) => new Promise<void>((done) => {
    (window as unknown as { __startfield: { stepTo(ms: number): void } }).__startfield.stepTo(t * 1000);
    requestAnimationFrame(() => requestAnimationFrame(() => done()));
  }), t);
  // And a moment more for the compositor to put it on the screen: a shot
  // taken before that comes back as the frame before it.
  await r.page.waitForTimeout(20);
}

// A shot of the set, also as one of the guide's pictures (copied only when it differs).
function forGuide(from: string, name: string, ext = 'webp'): void {
  const source = path.join(out, `${from}.${ext}`), target = path.join(guide, `${name}.${ext}`);
  if (existsSync(target) && readFileSync(target).equals(readFileSync(source))) {
    console.log(`same     ${path.relative(root, target)} (= ${from}.${ext})`);
    return;
  }
  copyFileSync(source, target);
  console.log(`wrote    ${path.relative(root, target)} (= ${from}.${ext})`);
}

// The running window with each part outlined and named, for the guide.
const PARTS: [string, string][] = [
  ['.titlebar .toolbar', 'Toolbar'], ['section[aria-label="Editor"]', 'Editor'], ['section[aria-label="Assemble"]', 'Assemble'],
  ['section[aria-label="Registers"]', 'Registers'],
  ['section[aria-label="Text"]', 'Text · Data'], ['section[aria-label="Inspector"]', 'Inspector'],
  ['section[aria-label="Console"]', 'Console'], ['footer.status', 'Status bar'],
];
async function namedParts(r: Running, name: string): Promise<void> {
  await r.page.evaluate((parts) => {
    const layer = document.createElement('div');
    layer.id = 'guide-names';
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999';
    for (const [sel, label] of parts) {
      const b = document.querySelector(sel)!.getBoundingClientRect();
      const box = document.createElement('div');
      box.style.cssText = `position:fixed;left:${b.left + 1}px;top:${b.top + 1}px;width:${b.width - 2}px;height:${b.height - 2}px;`
        + 'border:2px solid #E8710A;border-radius:6px;box-sizing:border-box';
      const chip = document.createElement('div');
      chip.textContent = label;
      // The status bar's name on its own empty right end; the others on their bottom edge.
      const bar = sel === 'footer.status';
      chip.style.cssText = `position:fixed;left:${bar ? b.right - 90 : b.left + b.width / 2}px;top:${bar ? b.top + (b.height - 22) / 2 : b.bottom - 12}px;`
        + 'transform:translateX(-50%);background:#E8710A;color:#fff;font:700 13px/22px Pretendard,sans-serif;'
        + 'padding:0 10px;border-radius:11px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.25)';
      layer.append(box, chip);
    }
    document.body.append(layer);
  }, PARTS);
  const file = path.join(guide, `${name}.webp`);
  await r.page.mouse.move(-10, -10);
  await r.page.waitForTimeout(1100);
  await settle(r, await r.page.screenshot(), file, MAX_BYTES, 'lossless');
  await r.page.evaluate(() => document.getElementById('guide-names')?.remove());
}

// Opened and assembled, the editor's cursor back on line 1 (the click that
// focused it would leave its line lit next to the PC's).
async function assembled(r: Running, file: string): Promise<void> {
  await openAndAssemble(r, file);
  await r.page.keyboard.press('Control+Home');
}

async function steps(r: Running, n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) { await r.page.keyboard.press('F10'); await settled(r.page); }
}

async function lab04(r: Running): Promise<void> {
  await assembled(r, sample(r.dir, LAB04, 'lab04.s'));
  await steps(r, LAB04_STEPS);
}

{
  const r = await launch({ width: 1280, height: 800 });
  const { page } = r;
  // Three moments of the board's opening: 1.0 s, 5.0 s and start's own, settled (START_AT).
  for (const [n, t] of [[1, 1.0], [3, 5.0]]) { await boardAt(r, t); await photo(r, `start-frame-${n}`); }
  await boardAt(r, START_AT);
  await photo(r, 'start');
  forGuide('start', '01-start');
  await page.getByRole('button', { name: /바로 시작/ }).click();
  await photo(r, 'start-2');
  await openOnly(r, sample(r.dir, LAB04, 'lab04.s'));
  await shot(r, 'split-before');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+s');
  await page.waitForSelector('.run-grid:not([hidden])');
  await page.keyboard.press('Control+Home');
  await shot(r, 'assembled');
  await lab04(r);
  await shot(r, 'split-running');
  await namedParts(r, '03-panels');
  await (await textRow(page, PINNED)).locator('.dis').click();
  await page.waitForSelector('.insp .bitgrid');
  await shot(r, 'inspector');
  await page.getByTitle('New file').click();
  await page.waitForSelector('dialog.ask');
  await shot(r, 'dialog');
  await page.keyboard.press('Escape');
  // The code changed after assembling (a line added at the top): the machine
  // stays, the band over it, the Assemble panel says so; then an error in
  // the changed code, assembled: the list under the Editor, the machine kept.
  await lab04(r);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.insertText('# 고쳐 보는 중\n');
  await page.waitForSelector('.run-band:not([hidden])');
  await shot(r, 'edited');
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('        srll t5, t6, 1\n');
  await page.keyboard.press('Control+s');
  await page.waitForSelector('.asm[data-state=errors]');
  await layoutSettled(r);
  await page.keyboard.press('Control+Home');
  await shot(r, 'error-kept');
  await assembled(r, sample(r.dir, ERROR));
  await page.waitForSelector('.asm .item');
  await shot(r, 'error');
  await assembled(r, program(r.dir, 'typo.s', TYPO));
  await page.waitForSelector('.asm .item');
  await shot(r, 'error-near-miss');
  await assembled(r, sample(r.dir, 'tests/samples/editor-errors.s'));
  await page.waitForSelector('.asm .item + .item');
  await shot(r, 'error-several');
  await assembled(r, sample(r.dir, DATA));
  await steps(r, DATA_STEPS);
  await page.locator('.ptab', { hasText: 'Data' }).click();
  await page.waitForSelector('.drow');
  await shot(r, 'data');
  await r.close();
}

// The Inspector in each of the six formats (tests/e2e/inspector-formats.e2e.ts's program):
// R, I, U, S, B, J, the word in its fields and the scattered immediate put together.
{
  const r = await launch({ width: 1280, height: 800 });
  await assembled(r, program(r.dir, 'formats.s', FORMATS));
  await steps(r, 1);
  for (const f of ['R', 'I', 'U', 'S', 'B', 'J']) {
    await r.page.waitForFunction((k) => document.querySelector('.insp .badge')?.textContent === k, f);
    await shot(r, `inspector-${f}`);
    await steps(r, 1);
  }
  await r.close();
}

// The first screen's two steps at the other widths: the lab PC (1093x582
// at 125%), 1024x768, 1366x768 at 150% (910x505) and the maximised 1920.
for (const [name, size, scale] of [
  ['1093', { width: 1093, height: 582 }, '1.25'],
  ['1024', { width: 1024, height: 728 }, '1'],
  ['910', { width: 910, height: 505 }, '1.5'],
  ['1920', { width: 1920, height: 1040 }, '1'],
] as const) {
  const r = await launch(size, { switches: [`--force-device-scale-factor=${scale}`] });
  await boardAt(r, START_AT);
  await photo(r, `start-${name}`);
  await r.page.getByRole('button', { name: /바로 시작/ }).click();
  await photo(r, `start-2-${name}`);
  await r.close();
}

// A maximised 1920x1080 screen (1920x1040 under the taskbar): the Editor at
// what 72 columns need, the rest of the width on the Run side; and the
// Errors panel there.
{
  const r = await launch({ width: 1920, height: 1040 });
  await lab04(r);
  await shot(r, 'max-1920');
  await assembled(r, sample(r.dir, ERROR));
  await r.page.waitForSelector('.asm .item');
  await shot(r, 'errors-max');
  await r.close();
}

// The lab PC: 1366x768 at 125%, maximised -- 1093x582 CSS px drawn at 1.25;
// and the heads of Registers and Text there, cut out (lab-columns).
// Narrow: 1366x768 at 150% (910x505 CSS px), under the 980 px split: the
// Editor / Run tabs in the title bar, on Run.  1024x768: 1024x728 (the
// taskbar), still side by side.
for (const [name, size, scale] of [
  ['lab-1366x768-125', { width: 1093, height: 582 }, '1.25'],
  ['narrow', { width: 910, height: 505 }, '1.5'],
  ['1024x768', { width: 1024, height: 728 }, '1'],
] as const) {
  const r = await launch(size, { switches: [`--force-device-scale-factor=${scale}`] });
  await lab04(r);
  if (name === 'narrow') await r.page.getByRole('tab', { name: 'Run' }).waitFor();
  await shot(r, name);
  if (name === 'lab-1366x768-125') {
    const regs = (await r.page.locator('.regs').boundingBox())!;
    const text = (await r.page.locator('.textpanel').boundingBox())!;
    await shot(r, 'lab-columns', { x: regs.x - 4, y: regs.y - 4, width: text.x + text.width - regs.x + 8, height: 190 });
  }
  await r.close();
}

// The tutorial (docs/PORTING.md 18, 25, 30): steps 1, 2 and 5 (the card right
// under the toolbar button it is about), 3 (Registers: both names), 4 (lui + addi), 9 (bits = Encoding), 14 (the gutter), 19 (the Assemble
// panel, after Assemble), 20 (its "N행으로 가기": the line to fix), 21;
// step 9 again in the narrow window.  Each step is entered as the tutorial
// enters it (its go()), which sets the machine up the same way every time.
async function tutorialStep(r: Running, n: number): Promise<void> {
  const { page } = r;
  if (!(await page.evaluate(() => (window as unknown as { __tutorial: { active: boolean } }).__tutorial.active))) {
    await page.getByRole('button', { name: /튜토리얼 보기/ }).click();
  }
  await page.evaluate((i) => (window as unknown as { __tutorial: { go(i: number): Promise<void> } }).__tutorial.go(i), n - 1);
  await page.waitForFunction((k) => (window as unknown as { __tutorial: { shown: { step: number } } }).__tutorial.shown.step === k, n);
  await page.waitForTimeout(600); // the Data tab and the lists settle; the card follows
}
{
  const r = await launch({ width: 1280, height: 800 });
  for (const n of [1, 2, 3, 4, 5, 9, 14]) { await tutorialStep(r, n); await shot(r, `tutorial-${String(n).padStart(2, '0')}`); }
  forGuide('tutorial-04', '02-tutorial-04');
  // The quit question over step 14: Haram in the dialog, the card and rings under the backdrop.
  await r.page.locator('.tut-card .tut-quit').click();
  await r.page.waitForSelector('dialog.ask[open]');
  await shot(r, 'tutorial-quit-ask');
  await r.page.locator('dialog.ask').getByRole('button', { name: '계속하기' }).click();
  // Step 18 done: the output pointed at, [다음] awaited.
  await tutorialStep(r, 18);
  for (let i = 0; i < 3 && !(await r.page.evaluate(() => (window as unknown as { __tutorial: { shown: { result: boolean } } }).__tutorial.shown.result)); i += 1) {
    await r.page.keyboard.press('F5');
    await r.page.waitForTimeout(700);
  }
  await r.page.waitForTimeout(600);
  await shot(r, 'tutorial-18-done');
  await tutorialStep(r, 19);
  await r.page.keyboard.press('Control+s');
  await r.page.waitForFunction(() => (window as unknown as { __tutorial: { shown: { phase: number } } }).__tutorial.shown.phase === 1);
  await r.page.waitForTimeout(600);
  await shot(r, 'tutorial-19');
  // "N행으로 가기", as a student presses it: step 20, the Editor at that line.
  await r.page.locator('.asm').getByRole('button', { name: /행으로 가기/ }).click();
  await r.page.waitForFunction(() => (window as unknown as { __tutorial: { shown: { step: number } } }).__tutorial.shown.step === 20);
  await r.page.waitForTimeout(600);
  await shot(r, 'tutorial-20');
  await tutorialStep(r, 21);
  await shot(r, 'tutorial-21');
  await r.close();
}
{
  const r = await launch({ width: 910, height: 505 }, { switches: ['--force-device-scale-factor=1.5'] });
  await tutorialStep(r, 9);
  await shot(r, 'tutorial-09-narrow');
  await r.close();
}
// The biggest font (24 px) in the narrowest window, with a twenty-column file
// name (docs/PORTING.md 30): the title bar at its last step -- the buttons as
// their icons, every one bordered, all on one middle line, nothing cut.
{
  const r = await launch({ width: 910, height: 505 }, { switches: ['--force-device-scale-factor=1.5'] });
  await openAndAssemble(r, sample(r.dir, 'tests/samples/lab04-ok.s', 'lab04_김학현_20210123.s'));
  for (let i = 0; i < 11; i += 1) await r.page.keyboard.press('Control+='); // 13 -> 24 px
  await r.page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--fs').trim() === '24px');
  await r.page.waitForTimeout(600);
  await shot(r, 'font-24-narrow');
  await shot(r, 'titlebar-24-narrow', { x: 0, y: 0, width: 910, height: 40 });
  await r.close();
}

// The whole screen, as Windows draws it (the caption buttons included):
// taken as PNG by the system, kept as lossless WebP (encoded by the app).
async function screen(r: Running, name: string): Promise<void> {
  // The real pointer onto the empty right end of the status bar (nothing
  // there reacts to it); CopyFromScreen does not draw the cursor.
  const png = path.join(out, `${name}.capture.png`);
  const ps = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$w = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point ($w.Right - 60), ($w.Bottom - 8)
Start-Sleep -Milliseconds 500
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$bmp.Save('${png}', [System.Drawing.Imaging.ImageFormat]::Png)`;
  const done = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
  if (done.status !== 0) throw new Error(`${name}: ${done.stderr}`);
  const bytes = readFileSync(png);
  unlinkSync(png);
  await settle(r, bytes, path.join(out, `${name}.webp`), MAX_BYTES, 'lossless');
}
if (process.platform === 'win32') {
  const r = await launch();
  await lab04(r);
  await r.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await r.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
  await r.page.waitForTimeout(1500);
  await screen(r, 'windows-frame');
  await r.close();
  // The tutorial on, maximised: the caption buttons' patch coloured with the dim.
  const t = await launch();
  await tutorialStep(t, 14);
  await t.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
  await t.page.waitForTimeout(1500);
  await screen(t, 'windows-frame-tutorial');
  await t.close();
}
