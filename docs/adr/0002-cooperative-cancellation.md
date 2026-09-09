# ADR 0002: Cooperative cancellation

## Status

Accepted

## Decision

Provider streams and PTY commands actively stop through an abort signal. Native operations without
cancellation support are awaited or observed through a bounded stop deadline before the caller
returns. Every stop attempt reports `stopped`, `still_running`, or `unknown`, with structured
failures when authorization, interrupt, kill, wait, or timeout handling did not complete.

Cancellation is not completion. If a provider or terminal operation settles after cancellation, or
the runtime cannot confirm that the PTY stopped, the turn ends as `cancelled_partial`. The terminal
remains retained and quarantined when liveness is unknown; it is not reused, hidden, or reported as
cleanly stopped. Late settlements may add diagnostics but cannot resurrect the session or clear a
newer owner.

## Consequences

The UI never reports completed cancellation while an untracked mutation continues. It can show a
partial-cancellation state with the stop status and failure details, while the runtime remains the
source of truth for eventual exit and cleanup.
