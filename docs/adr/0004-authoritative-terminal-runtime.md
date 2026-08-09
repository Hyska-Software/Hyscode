# ADR 0004: Authoritative terminal runtime

## Status

Accepted

## Decision

The PTY runtime owns process lifecycle, ordered output replay, and exit state. In Desktop, that
authority is the Rust PTY registry exposed through `DesktopTerminalRuntime`; in the standalone CLI,
it is `CliHost` plus `node-pty` exposed through `CliTerminalRuntime`. Frontend/TUI terminal views
are projections: they attach and detach without owning the process. Every terminal has an explicit
`user` or `agent` role, conversation/owner identity, normalized `cwd`, and effective permissions.
Agent reuse is limited to the same owner, conversation, and working directory; a manual terminal is
never an agent terminal.

Foreground commands use framed, shell-specific output capture. Background commands always use a
dedicated terminal and return an opaque terminal id that can be read or stopped with terminal tools.
Live output events are ephemeral UI progress; the final tool result remains the canonical transcript
content delivered to the model. Runtime terminal events are emitted through a multi-subscriber hub.
Subscriptions register before taking a snapshot, queue concurrent PTY events, replay the snapshot,
deduplicate by sequence, and deliver each exit once. Completed sessions remain inspectable until
explicit cleanup or runtime shutdown.

The bridge includes current terminal summaries in every `runtime_ready` payload and emits
`terminal_updated` events for creation, output, state, and exit. `terminal_resize` follows the same
protocol. The fullscreen VORTEX client uses the bridge in-process; `vortex --protocol ndjson` and
the compatibility runtime entrypoint expose the same request/event loop for automation. The
in-process VORTEX client may open a temporary `TerminalHandoff` only for a manual user terminal in
the current conversation. Handoff forwards raw PTY output/input and validated viewport dimensions,
but the runtime retains lifecycle, ownership, replay, and exit authority. `Ctrl-]` detaches;
process exit, errors, and signals restore the TUI. NDJSON remains non-interactive and never carries
raw PTY stdin/stdout bytes.

Interactive prompts suspend the command as a resumable terminal interaction. The agent may continue
it only through an independently approved terminal-input tool. Sensitive prompts remain user-only.
Manual xterm input is enabled while a process is waiting when the approval mode is not
`yolo`; it remains blocked while the harness actively owns the PTY. The fullscreen handoff is a
separate user-terminal path and never bypasses agent ownership or approval boundaries.

## Consequences

- Hiding, moving, or remounting xterm does not stop a process or lose buffered output.
- Terminal output and last-command context cannot cross conversation ownership.
- User input cannot write to an agent terminal unless that terminal is waiting for input, has no
  active tool owner, and the approval mode permits manual input; sensitive prompts remain user-only.
- PTY output combines stdout and stderr; consumers must not claim separate streams.
- Timeout and cancellation interrupt the process and escalate to terminating an unresponsive PTY.
- Interactive commands can cross agent iterations without losing their PTY, framing, or ownership.
- CLI and Desktop use the same Harness terminal contract while keeping their PTY authorities local to
  their host/runtime boundary.
