# ADR 0003: Turn ownership by conversation tab

## Status

Accepted

## Decision

Each active turn is bound to its initiating tab and conversation. Events with another identity are ignored. The owning tab cannot be closed or switched while its turn is active.

## Consequences

Streaming output, approvals, results, and terminal state cannot leak into another conversation.
