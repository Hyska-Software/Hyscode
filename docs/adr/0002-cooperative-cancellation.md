# ADR 0002: Cooperative cancellation

## Status

Accepted

## Decision

Provider streams and PTY commands actively stop through an abort signal. Native operations without cancellation support are awaited. If one completes after cancellation, the terminal status is `cancelled_partial`.

## Consequences

The UI never reports completed cancellation while an untracked mutation continues.
