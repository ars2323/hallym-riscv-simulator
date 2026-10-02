# Sample for the editor's error list: errors on three lines; RARS reports them all.
	.data
msg:	.asciz "안녕하세요\n"	# 한글 주석 (UTF-8)

	.text
	.globl main
main:	li a7, 4
	la a0, msg
	ecall
	addi t0, zero, 70000		# immediate out of range
	slli t1, t0, 40		# shift distance out of range
	addi t2, t2, )		# syntax error
	ret
