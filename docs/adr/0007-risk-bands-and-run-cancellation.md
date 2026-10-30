# 0007 - Risk bands and best-effort run cancellation

Status: Accepted

The earlier default question used explicit `noul` criteria. That part of the decision was superseded by [ADR 0009](0009-e02-default-question.md), which adopts E02 with criteria omitted. The thresholds and run-cancellation decisions below remain in effect.

## Decision

Use a configurable `noul` exfiltration-violation question by default, with `denyLabel: "true"`; [ADR 0009](0009-e02-default-question.md) records the current question and omitted criteria. Default cutoffs are below 0.50 allow, [0.50, 0.70) block for manual review, and at least 0.70 deny. These are policy cutoffs, not calibrated probabilities. Explicit `choice` questions, polarity, thresholds and `escalateAction` remain configurable; `score` cannot drive policy.

At a finite classified signal of at least `stopThreshold` (default 0.90), also request best-effort cancellation of the calling session's current conversation run. `null` disables this action. Failures, unclassifiable output, blocked hosts and denied tools never trigger cancellation. The tool call always blocks even if cancellation is unavailable.

OpenCode 1.19.4 provides no supported native question or permission creation API from `tool.execute.before`; the middle band blocks without simulating an approval prompt. Existing downstream native permissions remain intact.

Resolve up to 32 ancestor sessions with cycle checks and a two-second total lookup deadline while the hook is suspended. Throw the tool block before a zero-delay timer starts root-first concurrent abort requests, bounded to two seconds total. An ancestry failure still permits cancellation of the origin and known ancestors. Never delete sessions, terminate the process, or target unrelated roots. In-flight cancellation blocks tools in the affected chain and clears on completion or timeout. SDK errors produce only fixed sanitized warnings and manual interrupt guidance.

## Consequences

Emergency and escalation decisions are excluded from the TTL cache. Concurrent requests may share a fresh classification, but each actual call uses its own session and hook-entry generation. Cancellation operations are instance-local, transient and deduplicated per root generation, separately from the decision cache.

The `chat.message` hook advances observed generations on new message IDs (using the resolved output message ID when the input ID is absent). A hook-entry snapshot predates judge evaluation; new messages on any resolved ancestor invalidate cancellation before scheduling and again before dispatch. The public abort endpoint is session-scoped, not atomic per run: a new user message can race a dispatched abort, and absent chat events prevent complete generation tracking. Best-effort cancellation does not guarantee termination of child processes or other tool activity. The conversation remains available for follow-up.
