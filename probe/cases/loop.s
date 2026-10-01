# tight loop: 3 instructions per iteration; a0 = iteration count
        .text
main:   li   t0, 0
        li   t1, 1000000
loop:   addi t0, t0, 1
        addi t2, t2, 3
        blt  t0, t1, loop
        mv   a0, t0
        li   a7, 10
        ecall
