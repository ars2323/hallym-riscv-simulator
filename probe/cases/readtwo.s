# two ReadInt calls in a row, prints their sum
        .text
main:   li   a7, 5
        ecall
        mv   t0, a0
        li   a7, 5
        ecall
        add  a0, a0, t0
        li   a7, 1
        ecall
        li   a7, 10
        ecall
