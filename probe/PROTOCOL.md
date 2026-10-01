# RarsProbe stdio protocol

One JSON object per line in each direction. Requests carry `id`; replies echo it.
Messages without `id` are events (`ev`). Addresses and register values are signed
32-bit integers as RARS stores them.

| request | reply / effect |
|---|---|
| `{"cmd":"assemble","source":"..."}` | `ok`, `warnings[]`, `text[]` (`addr code basic line src`), `pc` — or `ok:false`, `errors[]` (`line col warning message`) |
| `{"cmd":"step"}` | one instruction. `reason` (`MAX_STEPS`, `BREAKPOINT`, `NORMAL_TERMINATION`, `CLIFF_TERMINATION`, `EXCEPTION`, `STOP`), `steps`, `ns`, `executed{addr code basic line src}`, `pc`, `x[32]`, `f[32]`; plus `exit` when done, `cause message line` on an exception |
| `{"cmd":"run","max":N?,"backstep":bool?}` | same as step without `executed`; reply arrives when the run ends |
| `{"cmd":"stop"}` | `was_running`; the pending step/run then replies with `reason:"STOP"` |
| `{"cmd":"bp","set":[addr,...]}` | replaces the breakpoint list (empty list clears) |
| `{"cmd":"backstep"}` | undoes one instruction (RARS back-stepper), returns `pc x f` |
| `{"cmd":"regs"}` | `pc x[32] f[32]` |
| `{"cmd":"mem","addr":A,"len":N}` | `hex` (2 chars per byte) or `ok:false,error` |
| `{"cmd":"input","text":"21\n"}` | appends to the console input |
| `{"cmd":"status"}` | `busy waiting terminated` |
| `{"cmd":"quit"}` | exits |

Events: `ready{rars}`, `out{text}` / `err{text}` (program console output, one per
flush), `input_wanted{pc}` (the program is blocked on console input; `pc` is already
past the ecall because RARS increments PC before executing).

While a step/run is in flight, only `stop`, `input`, `status`, `ping`, `quit` are
accepted; everything else replies `busy`.
