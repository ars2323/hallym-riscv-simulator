# three deliberate assemble errors on lines 3, 4, 6
        .text
main:   addi t0, t0           # missing operand
        lw   t9, 0(sp)        # no register t9
        li   a7, 10
        bogus a0, a1          # unknown mnemonic
        ecall
