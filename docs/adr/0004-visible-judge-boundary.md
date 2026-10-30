# ADR 0004: Keep the judge boundary visible

**Status:** Accepted

## Context

The judge evaluates rendered tool state. Depending on the call, that state can include sensitive command arguments, extracted facts, and content from tracked files that a later shell call references.

## Decision

Send review state to the configured primary System One endpoint. If an optional fallback is configured, send the same state there only after a primary timeout. Treat every configured endpoint as trusted with the submitted data. Keep redaction out of judge requests and document that audit/error redaction is best-effort.

## Consequences

Users must choose trusted endpoints and protect audit files. The default loopback endpoint uses HTTP; a bearer API key does not encrypt traffic. Documentation must not suggest that audit redaction protects judge requests. The timeout-only fallback tradeoff is recorded in [ADR 0010](0010-timeout-only-fallback.md).
