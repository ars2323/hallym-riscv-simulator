# never terminates; used to test Stop
        .text
main:   addi t0, t0, 1
        j    main
