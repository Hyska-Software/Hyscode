# ADR 0004: Authoritative terminal runtime

## Status

Accepted

## Decision

The Rust PTY registry owns process lifecycle, ordered output replay, and exit state. Frontend
terminal views attach and detach without owning the process. Every agent terminal is owned by one
conversation and exposed to the harness through the desktop terminal runtime adapter.

Foreground commands use framed, shell-specific output capture. Background commands always use a
dedicated terminal and return an opaque terminal id that can be read or stopped with terminal tools.
Live output events are ephemeral UI progress; the final tool result remains the canonical transcript
content delivered to the model.

Interactive prompts suspend the command as a resumable terminal interaction. The agent may continue
it only through an independently approved terminal-input tool. Sensitive prompts remain user-only.
Manual xterm input is enabled while a process is waiting when the approval mode is not
`Auto-approve`; it remains blocked while the harness actively owns the PTY.

## Consequences

- Hiding, moving, or remounting xterm does not stop a process or lose buffered output.
- Terminal output and last-command context cannot cross conversation ownership.
- PTY output combines stdout and stderr; consumers must not claim separate streams.
- Timeout and cancellation interrupt the process and escalate to terminating an unresponsive PTY.
- Interactive commands can cross agent iterations without losing their PTY, framing, or ownership.
