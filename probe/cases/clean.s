# reads the words dirty.s wrote and the heap pointer it gets; a clean simulator
# prints "0 0 <same heap base as a fresh run>"
        .data
buf:    .word 0
        .text
main:   la   t0, buf
        lw   a0, 0(t0)
        li   a7, 1
        ecall
        li   a0, 32
        li   a7, 11
        ecall
        lw   a0, 64(t0)
        li   a7, 1
        ecall
        li   a0, 32
        li   a7, 11
        ecall
        li   a0, 4096
        li   a7, 9
        ecall
        li   a7, 1
        ecall
        li   a7, 10
        ecall
