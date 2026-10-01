# reads an int from the console, prints 2x, exits
        .text
main:   li   a7, 5          # ReadInt
        ecall
        add  a0, a0, a0
        li   a7, 1          # PrintInt
        ecall
        li   a7, 11         # PrintChar
        li   a0, 10
        ecall
        li   a7, 10
        ecall
