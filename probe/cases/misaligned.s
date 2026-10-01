# load word from an address that is not 4-byte aligned
        .data
w:      .word 1, 2
        .text
main:   la   t0, w
        lw   t1, 1(t0)        # line 6: misaligned
        li   a7, 10
        ecall
