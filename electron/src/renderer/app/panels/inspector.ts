/* The Inspector: one instruction taken apart -- the word as thirty-two
   bits, MSB on the left, grouped into its fields; under it one line per
   field; then what the instruction does, with the values it will use.
   (The MIPS edition's inspector.ts, for RISC-V.)

   RISC-V has six formats (R, I, S, B, U, J) and its immediates are cut
   into pieces scattered over the word.  This round takes R and I apart
   (add, addi, lw, jalr, ecall ...).  A word of another format still shows
   its format and its explanation-less head, and says that its picture
   comes later -- never a wrong picture.  Adding a format is an entry in
   src/core/decoder.ts FORMATS (and its fields' meaning in
   instruction-text.ts); nothing here changes.

   It follows the program: after every step it shows the instruction at PC
   (the next to run).  Choosing a row in Text pins it to that instruction
   until "Follow PC" (or Esc). */

import { decode, formatName, type InstructionField } from '../../../core/decoder.ts';
import { explain } from '../../../core/explain.ts';
import { hex32 } from '../../../core/format.ts';
import { immediateLine, meaningOf } from '../../../core/instruction-text.ts';
import { code, codeText, h } from '../dom.ts';
import { notice } from '../notice.ts';
import type { TextRow } from '../logic/machine.ts';
import { headButton, panelHead, type Head } from '../ui.ts';

// "imm[11:0]" -> "imm": the field's colour (app.css .f-*).
export const fieldClass = (name: string): string => `f-${name.replace(/\[.*$/, '')}`;

export class Inspector {
  readonly root: HTMLElement;
  readonly head: Head;
  private readonly body: HTMLElement;
  private readonly follow: HTMLButtonElement;
  onFollow: () => void = () => {};

  constructor() {
    this.head = panelHead('Inspector');
    this.follow = headButton('Follow PC', '다시 PC 위치의 명령을 따라갑니다 (Esc)', () => this.onFollow());
    this.head.aside.append(this.follow);
    this.body = h('div', { class: 'pbody ibody' });
    this.root = h('section', { class: 'panel insp', 'aria-label': 'Inspector' }, this.head.root, this.body);
    this.guide();
  }

  // Nothing to show yet: what this panel is for, and how to get something into it.
  guide(): void {
    this.setMode(null);
    this.body.classList.add('is-empty');
    this.body.replaceChildren(h('div', { class: 'notice-host' }, notice({
      title: '명령 하나를 32비트로 나누어 보는 곳입니다',
      body: codeText('`F10` 키로 한 줄 실행하거나 Text 탭에서 명령을 누르면 그 명령이 여기에 나옵니다.'),
    })));
  }

  // `pinned`: chosen in Text (else the instruction at PC).  `x`: x0..x31 before it runs.
  show(row: TextRow, x: readonly number[], pinned: boolean): void {
    this.setMode(pinned ? row.addr : 'pc');
    this.body.classList.remove('is-empty');
    const d = decode(row.word);
    const format = formatName(d.format);
    const head = h('div', { class: 'ihead' },
      code(row.disassembly, 'dis'), h('span', { class: `badge b-${format}` }, format),
      row.source ? h('span', { class: 'isrc' }, 'Source ', code(row.source)) : null,
      h('span', { class: 'grow' }),
      h('span', { class: 'where' }, code(hex32(row.word)), ' · ', code(hex32(row.addr))));
    if (!d.fields) {
      this.body.replaceChildren(head, h('div', { class: 'explain later' },
        h('b', {}, `${format} 형식`), ' — ', codeText('이 형식의 비트 분해는 다음 버전에서 보여 줍니다. 지금은 R 형식과 I 형식(`add`, `addi`, `lw` 명령 등)을 나누어 봅니다.')));
      return;
    }
    const fields = d.fields.map((f: InstructionField) => {
      const width = f.high - f.low + 1;
      return {
        name: f.name, high: f.high, low: f.low, width, cls: fieldClass(f.name),
        bits: f.value.toString(2).padStart(width, '0'),
        value: f.name === 'imm[11:0]' ? String(d.imm) : String(f.value),
        meaning: meaningOf(f, d),
      };
    });
    // The word as 32 cells, one per bit, each field a coloured group.
    const grid = h('div', { class: 'bitgrid' }, ...fields.map((f) =>
      h('div', { class: `fbox ${f.cls}`, style: `grid-column: span ${f.width}` },
        h('div', { class: 'franges mono' }, h('span', {}, String(f.high)), h('span', {}, f.high !== f.low ? String(f.low) : '')),
        h('div', { class: 'fbits mono', style: `grid-template-columns: repeat(${f.width}, 1fr)` },
          ...[...f.bits].map((b) => h('span', { class: 'bit' }, b))),
        h('div', { class: 'fname' }, f.name),
        h('div', { class: 'fmean mono' }, f.meaning || f.value))));
    const table = h('table', { class: 'ftable' },
      h('tr', {}, ...['Field', 'Bits', 'Binary', 'Value', 'Meaning'].map((t) => h('th', {}, t))),
      ...fields.map((f) => h('tr', {},
        h('td', {}, h('span', { class: `sw ${f.cls}` }), f.name),
        h('td', { class: 'mono', 'data-label': 'Bits' }, `${f.high}–${f.low}`), h('td', { class: 'mono', 'data-label': 'Binary' }, f.bits),
        h('td', { class: 'mono' }, f.value), h('td', { class: 'mono' }, f.meaning))));
    const e = explain(d, x);
    const imm = immediateLine(d);
    this.body.replaceChildren(head, grid,
      h('div', { class: 'explain' }, h('b', {}, e.title), e.sentence ? ' — ' : '', codeText(e.sentence),
        imm ? h('div', { class: 'note' }, code(imm)) : null),
      table);
  }

  private setMode(mode: 'pc' | number | null): void {
    this.follow.hidden = typeof mode !== 'number';
    this.root.classList.toggle('pinned', typeof mode === 'number');
    this.head.setMeta(mode === null ? '' : mode === 'pc'
      ? h('span', { class: 'mode' }, 'Following PC')
      : h('span', { class: 'mode pin' }, 'Pinned ', code(hex32(mode))));
  }
}
