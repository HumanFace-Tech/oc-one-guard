# ADR 0004: Keep the judge boundary visible

**Status:** Accepted

## Context

The judge evaluates rendered tool state. Depending on the call, that state can include sensitive command arguments, extracted facts, and content from tracked files that a later shell call references.

## Decision

Send review state only to the configured System One endpoint. Treat that endpoint as trusted with the submitted data. Keep redaction out of the judge request and document that audit/error redaction is best-effort.

## Consequences

Users must choose a trusted endpoint and protect audit files. The default loopback endpoint uses HTTP; a bearer API key does not encrypt traffic. Documentation must not suggest that audit redaction protects judge requests.
