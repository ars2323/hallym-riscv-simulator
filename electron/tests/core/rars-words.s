# Words for the decoder test (tests/core/decoder.test.ts): every RV32I
# instruction RARS assembles, some M and F ones, odd registers and
# immediates (negative, the 12-bit ends).  tools/gen-rars-words.ts runs this
# through the engine and writes rars-words.json.
        .data
d:      .word 0
        .text
main:
# R
        add   x1, x2, x3
        sub   t6, s11, a7
        sll   a0, a1, a2
        slt   s0, s1, s2
        sltu  t0, t1, t2
        xor   x31, x30, x29
        srl   a3, a4, a5
        sra   a6, a7, s3
        or    s4, s5, s6
        and   s7, s8, s9
        mul   t3, t4, t5
        mulh  a0, a0, a0
        mulhsu a1, a2, a3
        mulhu a4, a5, a6
        div   s10, t0, t1
        divu  x5, x6, x7
        rem   x8, x9, x10
        remu  x11, x12, x13
# I: arithmetic, shifts, loads, jalr, system
        addi  a0, zero, 5
        addi  t0, t0, -1
        addi  sp, sp, -2048
        addi  ra, gp, 2047
        slti  a1, a2, -7
        sltiu a3, a4, 100
        xori  a5, a6, -1
        ori   s0, s1, 0x7ff
        andi  s2, s3, 255
        slli  t1, t2, 31
        srli  t3, t4, 1
        srai  t5, t6, 17
        lb    a0, -1(sp)
        lh    a1, 2(gp)
        lw    a2, 0(sp)
        lw    a3, 2044(s0)
        lbu   a4, -2048(t0)
        lhu   a5, 6(a7)
        jalr  ra, 0(t1)
        jalr  zero, -4(ra)
        ecall
        ebreak
        csrrw t0, 0, t1
        csrrs t0, 0, x0
        csrrc a0, 0, a1
        csrrwi t0, 0, 5
        csrrsi t1, 0, 1
        csrrci t2, 0, 31
        fence 1, 1
        fence.i
# S
        sb    a0, -1(sp)
        sh    a1, 2(gp)
        sw    a2, 2047(s0)
        sw    ra, -2048(sp)
# B
        beq   a0, a1, main
        bne   t0, zero, main
        blt   s0, s1, after
        bge   a2, a3, after
        bltu  a4, a5, main
        bgeu  t5, t6, after
after:
# U
        lui   a0, 0x12345
        lui   t0, 0xfffff
        auipc a1, 0
        auipc s0, 0x80000
# J
        jal   ra, main
        jal   zero, after
# F
        flw   ft0, 0(sp)
        fld   fa0, 8(sp)
        fsw   ft1, 4(sp)
        fsd   fs0, -8(sp)
        fadd.s ft2, ft0, ft1
        fsub.s fa1, fa2, fa3
        fmul.d fs1, fs2, fs3
        fdiv.d ft3, ft4, ft5
