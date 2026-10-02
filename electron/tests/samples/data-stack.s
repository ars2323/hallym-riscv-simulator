# Data and stack, for the memory tests: words, halves, bytes, a string,
# and a few words pushed on the stack.
        .data
hello:  .asciz  "Hello, data!"
        .align  2
nums:   .word   1, 2, 3, -1
half:   .half   0x1234, -2
bytes:  .byte   0x41, 0x42, 0x43, 0x44
big:    .word   0xabcd1234
        .text
main:   addi    sp, sp, -16
        li      t0, 0x00400018
        sw      t0, 12(sp)
        li      t0, 0x7fffffe6
        sw      t0, 0(sp)
        li      a7, 10
        ecall
