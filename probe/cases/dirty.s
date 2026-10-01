# leaves state behind: writes a marker into the data segment, grows the heap,
# and prints the heap pointer it got
        .data
buf:    .word 0
        .text
main:   la   t0, buf
        li   t1, 0x5a5a5a5a
        sw   t1, 0(t0)
        sw   t1, 64(t0)       # beyond anything clean.s initialises
        li   a0, 4096
        li   a7, 9            # Sbrk
        ecall
        li   a7, 1
        ecall
        li   a7, 10
        ecall
