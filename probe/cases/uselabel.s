# refers to "buf", which only dirty.s defines; must fail to assemble on its own
        .text
main:   la   t0, buf
        li   a7, 10
        ecall
