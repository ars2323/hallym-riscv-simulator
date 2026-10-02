# 한글 주석: 출력
        .data
msg:    .asciz "안녕하세요, RISC-V!\n"
        .text
main:   la      a0, msg     # 출력
        li      a7, 4
        ecall
        li      a7, 10
        ecall
