/* What each field of a taken-apart word means, for the Inspector's table
   and the line under each field in its picture.  Pure.  (The MIPS edition's
   instruction-text.ts, for RISC-V's fields.) */

import { type DecodedInstruction, type InstructionField } from './decoder.ts';
import { bothNames } from './registers.ts';

const OPCODES: Record<number, string> = {
  0x33: 'OP', 0x53: 'OP-FP', 0x13: 'OP-IMM', 0x03: 'LOAD', 0x07: 'LOAD-FP', 0x67: 'JALR', 0x73: 'SYSTEM', 0x0f: 'MISC-MEM',
  0x23: 'STORE', 0x27: 'STORE-FP', 0x63: 'BRANCH', 0x37: 'LUI', 0x17: 'AUIPC', 0x6f: 'JAL',
};
export const opcodeName = (opcode: number): string => OPCODES[opcode] ?? '?';

// Registers that belong to the floating-point file, by instruction.
const fpRegisters = (d: DecodedInstruction): boolean => d.opcode === 0x53;

export function meaningOf(f: InstructionField, d: DecodedInstruction): string {
  switch (f.name) {
    case 'opcode': return opcodeName(f.value);
    case 'rd':
      if (d.opcode === 0x07) return `f${f.value}`;            // flw/fld write an f register
      return fpRegisters(d) ? `f${f.value}` : bothNames(f.value);
    case 'rs1': return fpRegisters(d) ? `f${f.value}` : bothNames(f.value);
    case 'rs2': return fpRegisters(d) ? `f${f.value}` : bothNames(f.value);
    case 'funct3': return d.name ? `${d.name}` : '';
    case 'funct7': return d.funct7 === 0x20 ? '0100000 (sub / sra)' : d.funct7 === 1 ? '0000001 (M extension)' : '';
    case 'imm[11:0]': return String(d.imm);                    // sign-extended
    case 'shamt': return `${f.value}비트`;
    default: return '';
  }
}

/* The immediate's value as the instruction uses it, said once:
   "imm = 0xffb = -5 (12 bits, sign-extended)". */
export function immediateLine(d: DecodedInstruction): string | null {
  if (d.format !== 'I' || !d.fields) return null;
  const f = d.fields.find((x) => x.name === 'imm[11:0]');
  if (!f) return null;
  return `imm = 0x${f.value.toString(16).padStart(3, '0')} = ${d.imm} (12비트, 부호 확장)`;
}
