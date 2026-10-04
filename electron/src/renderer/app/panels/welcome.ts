/* The first screen: the mark, the product's name and two ways in -- the
   tutorial program, or straight to work (a new file, or one from disk).  No
   recent files: nothing of a session is kept (lab PCs are shared).

   Both steps have the same shape: the card has a fixed width, each choice a
   fixed size with its line break written in, and the "← 처음으로" row is
   there in both (hidden in the first), so going from one step to the other
   moves nothing but the words.  Behind the card, the same for both steps:
   the circuit board (../../startfield/), which a step never restarts.

   The card is the chip.  It carries CHIP_ATTR, which is how the board finds
   the rectangle to put its pins on -- there is no second drawn square under
   it, so the two can never disagree.

   The light that runs round the buttons and across the name is driven from
   here, off the board's own clock (start.onFrame) and its own seed
   (spark.ts), and drawn by the card's own CSS.  Not by a canvas over the
   card: the card is opaque, so that canvas would have to cover the buttons,
   and its pixels and the buttons' boxes would part company at every font
   load and every resize.  An element's own box cannot come adrift from
   itself. */

import { asset, h, icon } from '../dom.ts';
import { CHIP_ATTR, startfield } from '../../startfield/index.ts';
import { offsets, SEED, type SparkName, sparkAt } from './spark.ts';

/** The product name on the package.  The seed the board is grown from is in
    spark.ts, with what else is derived from it. */
export const WORDMARK = 'Hallym RISC-V Simulator';
export { SEED };

export interface WelcomeEvents {
  tutorial(): void;
  newFile(): void;
  openFile(): void;
}

function action(label: string, ic: string, onClick: () => void, main = false): HTMLElement {
  const b = h('button', { class: `action${main ? ' main' : ''}`, type: 'button' }, icon(ic), h('b', {}, label));
  b.addEventListener('click', onClick);
  return b;
}

export function welcome(events: WelcomeEvents): { root: HTMLElement; show(on: boolean): void } {
  const actions = h('div', { class: 'actions' });
  const back = h('button', { class: 'linkbtn back', type: 'button' }, '← 처음으로');
  /* Straight to work first, the tutorial under it: the one most of them
     want is the one at the top, and the hierarchy of the two -- border,
     words, ground, and the light each carries -- says which is which. */
  const first = () => {
    actions.replaceChildren(
      action('바로 시작', 'play', second, true),
      action('튜토리얼 보기', 'circle-question-mark', events.tutorial));
    back.style.visibility = 'hidden';
  };
  const second = () => {
    actions.replaceChildren(
      action('새 파일', 'file-plus', events.newFile, true),
      action('파일 열기', 'folder-open', events.openFile));
    back.style.visibility = 'visible';
    (actions.firstElementChild as HTMLElement).focus();
  };
  back.addEventListener('click', first);
  first();
  // The seed is a constant: the same board every start, on every machine.
  const start = startfield({ seed: SEED });

  /* Four things, down the middle of the die frame: the mark, the product's
     name, and the two ways in.  The symbol is the top bar's own file
     (marks/symbol-basic.svg, a vector, so it is sharp at any size) in its
     own colours -- the university's rules forbid recolouring it, and the
     repository holds no reversed version for a dark ground
     (assets/hallym/README.md). */
  const title = h('span', { class: 'wtitle', 'data-text': WORDMARK }, WORDMARK);
  const card = h('div', { class: 'wcard', [CHIP_ATTR]: '' },
    h('div', { class: 'wstack' },
      h('img', { class: 'wlogo', src: asset('hallym/marks/symbol-basic.svg'), alt: '' }),
      title,
      h('div', { class: 'wbody' }, actions, back)));

  /* The column centred by what can be SEEN, not by its boxes.  The flex
     column centres the boxes, and a box can hold nothing visible: on the first
     step the way back ("← 처음으로", visibility: hidden, 14 + 18 px) is under
     the buttons, so the boxes were centred and the ink sat 15.6 px high --
     72 px above it and 103 below inside the die frame at 1920x1080, 1.43 : 1
     (MIPS 2.8.0 measured the same on its release's film, 1.42).  And the mark
     is a picture: its own transparent margin is part of its box.  So: the
     ink's top and bottom -- the mark's from its alpha, the name's and the two
     buttons' from their boxes -- measured inside the column, and the column
     moved by what puts their middle on the die frame's.  Measured relative to
     the column itself, so the move already made does not enter it.  The way
     back is left out on both steps, and a step does not centre again: counted
     when it shows, the second step moved everything up 15 px, and measured
     again at the step, 1 px (rounding); the screen keeps its shape from one
     step to the other (tests/e2e/editor.e2e.ts).  The two steps hold the same
     ink -- the mark, the name, two buttons of one height -- so the move made
     for the first is the second's.  (To go back to MIPS: docs/PORTING.md.) */
  const stack = card.firstElementChild as HTMLElement;
  const logo = stack.querySelector<HTMLImageElement>('.wlogo')!;
  let logoInk: { top: number; bottom: number } | null = null;   // fractions of the mark's height
  const measureLogo = (): void => {
    if (!logo.complete || logo.naturalWidth === 0) return;
    const c = document.createElement('canvas');
    c.width = 256; c.height = Math.max(1, Math.round(256 * logo.naturalHeight / logo.naturalWidth));
    const g = c.getContext('2d');
    if (!g) return;
    g.drawImage(logo, 0, 0, c.width, c.height);
    const a = g.getImageData(0, 0, c.width, c.height).data;
    let top = -1, bottom = -1;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) if (a[(y * c.width + x) * 4 + 3] > 8) { if (top < 0) top = y; bottom = y + 1; break; }
    }
    if (top >= 0) logoInk = { top: top / c.height, bottom: bottom / c.height };
  };
  const centre = (): void => {
    const box = stack.getBoundingClientRect();
    if (box.height === 0) return;                              // not on the screen
    let top = Infinity, bottom = -Infinity;
    const ink = (t: number, b: number): void => { top = Math.min(top, t - box.top); bottom = Math.max(bottom, b - box.top); };
    const l = logo.getBoundingClientRect();
    ink(l.top + l.height * (logoInk?.top ?? 0), l.top + l.height * (logoInk?.bottom ?? 1));
    for (const el of [title, ...actions.children] as HTMLElement[]) {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.height > 0) ink(r.top, r.bottom);
    }
    if (top === Infinity) return;
    stack.style.setProperty('--ink-shift', `${Math.round(box.height / 2 - (top + bottom) / 2)}px`);
  };
  logo.addEventListener('load', () => { measureLogo(); centre(); });
  void document.fonts?.ready.then(centre);
  new ResizeObserver(centre).observe(stack);

  /* The light, put on the elements as custom properties every frame of the
     board's clock.  Which element is which is by its place, not by its
     words: the first choice is always the one being pushed. */
  const phase = offsets(SEED);
  const put = (el: HTMLElement | null, name: SparkName, t: number): void => {
    if (!el) return;
    const { amp, at } = sparkAt(name, t, phase[name]);
    el.style.setProperty('--sp-amp', amp.toFixed(3));
    el.style.setProperty('--sp-at', at.toFixed(4));
  };
  const clear = (el: HTMLElement | null): void => {
    if (!el) return;
    el.style.removeProperty('--sp-amp');
    el.style.removeProperty('--sp-at');
  };
  const lit = (): (HTMLElement | null)[] => [title, ...actions.querySelectorAll<HTMLElement>('.action')];
  /* Turned down, nothing of it runs: the board draws its finished state once
     and the card is left at rest, not frozen half way through a pass.  A
     time before the opening is a time nothing is lit at. */
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  start.onFrame((t) => {
    const now = calm.matches ? -1 : t;
    put(title, 'title', now);
    const buttons = actions.querySelectorAll<HTMLElement>('.action');
    put(buttons[0] ?? null, 'primary', now);
    put(buttons[1] ?? null, 'secondary', now);
  });

  return {
    root: h('div', { class: 'welcome' }, start.root, card),
    show(on: boolean) {
      start.show(on);
      if (!on) for (const el of lit()) clear(el);   // nothing of it left off the screen
    },
  };
}
