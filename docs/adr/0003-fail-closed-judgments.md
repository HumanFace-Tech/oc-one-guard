# ADR 0003: Block when judgment fails or is unclear

**Status:** Accepted

## Context

A judge request can fail, return an unusable answer, or produce an escalation result where intent is unclear. Treating missing output as approval would silently bypass review.

## Decision

Default `failMode`, `unknownMode`, and `escalateAction` to `"block"`. Invalid configuration falls back to validated defaults and is reported in OpenCode logs.

## Consequences

Calls that need judge review can stop when the judge is offline or its response cannot be classified. Users can configure allow behavior, and prefilters or tool rules can bypass the judge by design; these defaults are not an unconditional fail-closed guarantee. This decision covers judge failures and unclear verdicts, not high-confidence run cancellation. Current risk bands and cancellation behavior are defined by [ADR 0007](0007-risk-bands-and-run-cancellation.md).
