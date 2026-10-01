# float register write, so the probe can read f registers
        .data
x:      .float 1.5
        .text
main:   la   t0, x
        flw  ft0, 0(t0)
        fadd.s ft1, ft0, ft0
        li   a7, 10
        ecall
