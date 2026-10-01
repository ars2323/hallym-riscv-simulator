# prints a string and an int, then exits with code 0
        .data
msg:    .asciz "hello, rars\n"
        .text
main:   la   a0, msg
        li   a7, 4          # PrintString
        ecall
        li   a0, 42
        li   a7, 1          # PrintInt
        ecall
        li   a7, 10         # Exit
        ecall
