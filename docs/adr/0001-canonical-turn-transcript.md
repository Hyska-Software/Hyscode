# ADR 0001: Canonical turn transcript

## Status

Accepted

## Decision

The harness owns provider-native assistant, thinking, tool-call, and tool-result blocks. Runtime events carry turn and iteration identity. Desktop adapters render and persist these blocks without rebuilding protocol frames.

## Consequences

Conversation replay uses the structured blocks originally sent to providers. Legacy rows without blocks remain readable as text-only messages.
