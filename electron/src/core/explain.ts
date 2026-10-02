/* One sentence that says what an instruction does, with the values it will
   use -- the Inspector's line under the picture.  Pure: it takes the
   decoded word and the register values *before* the instruction runs.
   (The MIPS edition's explain.ts, for RV32I's R and I instructions; the
   other formats come with their decoder entries.)

   Code -- register names, numbers taken from the machine -- is wrapped in
   backticks, which the view sets in the monospaced font.  A particle always
   follows a Korean noun (값(`…`)을, `x5` 레지스터에), never a register name
   or a number, whose reading would decide between 을/를, 이/가. */

import type { DecodedInstruction } from './decoder.ts';
import { hex32 } from './format.ts';
import { abiName } from './registers.ts';

export interface Explanation {
  title: string;    // "addi — Add Immediate"
  sentence: string; // with `code` parts; '' when there is nothing to add
}

const code = (s: string | number): string => '`' + s + '`';
const reg = (n: number): string => code(`x${n}`) + (n === 0 ? '' : `(${code(abiName(n))})`);
const val = (regs: readonly number[], n: number): string => `${reg(n)} 값(${code(hex32(regs[n] ?? 0))})`;

const TITLES: Record<string, string> = {
  add: 'Add', sub: 'Subtract', and: 'AND', or: 'OR', xor: 'XOR', sll: 'Shift Left Logical', srl: 'Shift Right Logical',
  sra: 'Shift Right Arithmetic', slt: 'Set if Less Than', sltu: 'Set if Less Than, Unsigned',
  mul: 'Multiply', div: 'Divide', divu: 'Divide, Unsigned', rem: 'Remainder', remu: 'Remainder, Unsigned',
  addi: 'Add Immediate', andi: 'AND Immediate', ori: 'OR Immediate', xori: 'XOR Immediate', slti: 'Set if Less Than Immediate',
  sltiu: 'Set if Less Than Immediate, Unsigned', slli: 'Shift Left Logical Immediate', srli: 'Shift Right Logical Immediate',
  srai: 'Shift Right Arithmetic Immediate', lw: 'Load Word', lh: 'Load Halfword', lb: 'Load Byte', lhu: 'Load Halfword, Unsigned',
  lbu: 'Load Byte, Unsigned', jalr: 'Jump And Link Register', ecall: 'Environment Call', ebreak: 'Environment Break',
};

// RARS's syscalls (a7), by the names the course uses.
const SYSCALLS: Record<number, string> = {
  1: 'PrintInt — `a0` 레지스터의 정수를 출력', 4: 'PrintString — `a0` 값이 가리키는 문자열을 출력',
  5: 'ReadInt — 정수 한 줄을 읽어 `a0` 레지스터에', 8: 'ReadString — 한 줄을 `a0` 값이 가리키는 곳에(최대 `a1` 값만큼)',
  9: 'Sbrk — `a0` 값만큼 할당해 그 주소를 `a0` 레지스터에', 10: 'Exit — 프로그램을 끝냄', 11: 'PrintChar — `a0` 레지스터의 문자를 출력',
  12: 'ReadChar — 문자 하나를 읽어 `a0` 레지스터에', 93: 'Exit2 — `a0` 값을 종료 코드로 끝냄',
};

function sentence(d: DecodedInstruction, regs: readonly number[]): string {
  const { rd, rs1, rs2, imm, name } = d;
  const to = `${reg(rd)} 레지스터에 넣습니다.`;
  const ops: Record<string, string> = { and: 'AND', or: 'OR', xor: 'XOR', andi: 'AND', ori: 'OR', xori: 'XOR' };
  switch (name) {
    case 'add': return `${val(regs, rs1)}과 ${val(regs, rs2)}을 더해 ${to} 넘쳐도 예외는 나지 않습니다.`;
    case 'sub': return `${val(regs, rs1)}에서 ${val(regs, rs2)}을 빼 ${to}`;
    case 'and': case 'or': case 'xor': return `${val(regs, rs1)}과 ${val(regs, rs2)}을 비트마다 ${ops[name]} 해 ${to}`;
    case 'sll': case 'srl': case 'sra':
      return `${val(regs, rs1)}을 ${val(regs, rs2)}의 아래 5비트만큼 ${name === 'sll' ? '왼쪽' : '오른쪽'}으로 옮겨 ${to}`
        + (name === 'sra' ? ' 빈 자리는 부호 비트로 채웁니다.' : '');
    case 'slt': case 'sltu':
      return `${val(regs, rs1)}이 ${val(regs, rs2)}보다 작으면 1, 아니면 0을 ${to} (${name === 'slt' ? '부호 있는' : '부호 없는'} 비교)`;
    case 'mul': return `${val(regs, rs1)}과 ${val(regs, rs2)}을 곱한 값의 아래 32비트를 ${to}`;
    case 'div': case 'divu': case 'rem': case 'remu':
      return `${val(regs, rs1)}을 ${val(regs, rs2)}로 나눈 ${name.startsWith('div') ? '몫' : '나머지'}을 ${to}`;
    case 'addi':
      if (rd === 0 && rs1 === 0 && imm === 0) return '아무것도 하지 않습니다(`nop`).';
      if (rs1 === 0) return `즉시값(${code(imm)})을 ${to} (\`li\` 명령이 이렇게 바뀝니다.)`;
      return `${val(regs, rs1)}에 즉시값(${code(imm)})을 더해 ${to}`;
    case 'andi': case 'ori': case 'xori': return `${val(regs, rs1)}과 즉시값(${code(imm)})을 비트마다 ${ops[name]} 해 ${to}`;
    case 'slti': case 'sltiu': return `${val(regs, rs1)}이 즉시값(${code(imm)})보다 작으면 1, 아니면 0을 ${to}`;
    case 'slli': case 'srli': case 'srai':
      return `${val(regs, rs1)}을 shamt 값(${code(d.rs2)})만큼 ${name === 'slli' ? '왼쪽' : '오른쪽'}으로 옮겨 ${to}`
        + (name === 'srai' ? ' 빈 자리는 부호 비트로 채웁니다.' : '');
    case 'lw': case 'lh': case 'lb': case 'lhu': case 'lbu': {
      const addr = ((regs[rs1] ?? 0) + imm) >>> 0;
      const size = { lw: '4바이트', lh: '2바이트', lb: '1바이트', lhu: '2바이트', lbu: '1바이트' }[name];
      return `${val(regs, rs1)}에 오프셋(${code(imm)})을 더한 ${code(hex32(addr))} 주소에서 읽은 ${size} 값을 ${to}`
        + (name.endsWith('u') ? ' 빈 윗자리는 0으로 채웁니다.' : name === 'lw' ? '' : ' 윗자리는 부호 비트로 채웁니다.');
    }
    case 'jalr': {
      const dest = (((regs[rs1] ?? 0) + imm) & ~1) >>> 0;
      return `${code(hex32(dest))} 주소로 뜁니다(${val(regs, rs1)} + ${code(imm)}). `
        + (rd === 0 ? '돌아올 주소는 남기지 않습니다(`ret`, `jr`).' : `다음 명령의 주소를 ${reg(rd)} 레지스터에 남깁니다.`);
    }
    case 'ecall': {
      const call = SYSCALLS[regs[17] ?? -1];
      return call ? `${code('a7')} 값(${code(regs[17])}): ${call}.` : `${code('a7')} 값(${code(regs[17] ?? 0)})의 시스템 호출을 부릅니다.`;
    }
    case 'ebreak': return '여기서 멈춥니다(디버거로 제어를 넘깁니다).';
    default: return '';
  }
}

export function explain(d: DecodedInstruction, regs: readonly number[]): Explanation {
  const t = TITLES[d.name];
  return { title: d.name ? (t ? `${d.name} — ${t}` : d.name) : '알 수 없는 명령', sentence: sentence(d, regs) };
}

/* "`x5` 값(...)" -> parts, the backticked ones as code. */
export function codeParts(text: string): { text: string; code: boolean }[] {
  return text.split('`').map((t, i) => ({ text: t, code: i % 2 === 1 })).filter((p) => p.text !== '');
}
