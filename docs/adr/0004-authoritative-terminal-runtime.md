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
deduplicate by sequence, and deliver each exit once. The configured shell and frame dialect are
resolved as one contract; unsupported shells fail before a command is written. Framed capture emits
its completion marker from a failure-safe shell cleanup path. Command source is transported as data
before evaluation: PowerShell uses UTF-8 Base64 decoding and `Invoke-Expression`, while POSIX shells
use a quoted literal and deferred `eval`; multiline commands and shell parse errors therefore cannot
prevent the wrapper from emitting its completion marker. The runner performs a bounded post-exit
snapshot drain before classifying a command without a marker as an execution error.
PowerShell framed capture keeps native stderr as output, including WinPS `NativeCommandError` records,
and derives the command status from the native exit code or non-native PowerShell errors rather than
from stderr or `$?` alone. Explicit command redirections remain owned by the command and are never
replayed by the wrapper.

Runtime failures are first-class lifecycle data, not plain log text. `TerminalRuntimeFailure` carries
the failing operation (`acquire`, `authorize`, `subscribe`, `snapshot`, `write`, `interrupt`, `kill`,
`reader`, `wait`, `protocol`, `event`, `release`, or `timeout`) and a diagnostic message. A `pty:exit` event,
terminal summary, and terminal progress record expose the failure when one is known; the exit event
is emitted at most once. A full snapshot (`after_sequence` omitted or `0`) is the authoritative
aggregate for output, sequence, exit code, and failure. A positive `after_sequence` request is an
output delta and must not replace newer lifecycle state.

Lifecycle calls use bounded deadlines. Cancellation and timeout await or observe the stop attempt
before the harness reports the command outcome. `pty_kill` returns a structured
`stopped`, `still_running`, or `unknown` status plus any failures. A session with unconfirmed
liveness remains retained and quarantined; it is never reused or reported as cleanly stopped.
Late acquire, write, interrupt, or kill settlements may add diagnostics but cannot resurrect a
session, clear a newer owner, or emit a second exit.

The PTY data plane never blocks the command surface. Each Desktop session owns a dedicated writer
thread fed by a channel, so `pty_write`, `pty_interrupt`, and lifecycle commands never hold the
registry lock across pipe I/O; a slow or saturated ConPTY input pipe can therefore not wedge output
draining or unrelated sessions. The reader decodes UTF-8 incrementally so multi-byte glyphs split
across reads are preserved and keeps buffering after the child exits instead of discarding late
output, while the waiter observes a bounded drain grace before publishing `pty:exit` so the final
frame of a full-screen application is delivered before the exit event. On Windows the child shell
and every descendant are placed in a kill-on-close job object, and the runtime confirms termination
through `try_wait` instead of trusting the platform kill result. Desktop ships the modern OpenConsole
`conpty.dll` next to the executable so portable-pty does not fall back to the legacy inbox ConPTY,
which is known to hang full-screen TUI applications.

Live terminal progress is a provisional projection. It may surface a runtime failure before the
canonical tool result is available, but it cannot synthesize a model result. A later canonical
`tool_call_result` replaces provisional progress, while an explicit failure remains visible in
terminal history and in read-only terminal inspection.

Completed sessions remain inspectable until explicit cleanup or runtime shutdown.

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
- `pty_write` acknowledges enqueueing to the session writer thread, not physical delivery to the
  child; asynchronous write failures surface through the session lifecycle and `pty:exit`.
- Stopping a session terminates the process tree, including TUI grandchildren, so closing a terminal
  cannot leave a full-screen application running without its console.
- On Windows the modern ConPTY binaries must be staged next to the executable
  (`scripts/copy-conpty.mjs` for dev and `bundle.resources` for installers); `pty_diagnostics`
  reports whether the sideloaded DLL was loaded.
- Timeout and cancellation interrupt the process and escalate to terminating an unresponsive PTY.
- A process exit is not treated as a timeout: the runtime drains buffered output, and an exit without
  a completion marker is reported immediately with its exit code when available.
- Interactive commands can cross agent iterations without losing their PTY, framing, or ownership.
- CLI and Desktop use the same Harness terminal contract while keeping their PTY authorities local to
  their host/runtime boundary.
