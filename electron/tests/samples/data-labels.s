# The Data tab's example
        .data
msg:    .asciz "Hello, RISC-V!"
        .align 2
count:  .word 3
table:  .word 0x12345678, -1, 255
        .text
main:
        la   a0, msg
        li   a7, 4
        ecall
        la   t1, count
        lw   t0, 0(t1)
        la   t1, table
        lw   t2, 4(t1)
        addi sp, sp, -8
        sw   t0, 4(sp)
        li   a7, 10
        ecall
