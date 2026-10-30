# 0010 - Use fallback only after a primary timeout

Status: Accepted

## Decision

Keep judge fallback optional and disabled by default. When configured, try it only if the primary request times out, including while the primary response body is being read. Do not retry network errors, HTTP errors, malformed responses, or unclassifiable verdicts.

Use the same rendered state, questions, and policy thresholds for both requests. The fallback supplies its own endpoint, model, optional API key or environment variable, and timeout. If the fallback request fails, apply `failMode`; if it returns an unclassifiable response, apply `unknownMode`. Both modes default to blocking. Classified audit decisions identify their source as `primary` or `fallback`.

## Rationale and consequences

A timeout is the one failure where another judge may return a usable decision without changing the policy inputs. Restricting fallback to that case avoids retrying responses that may indicate a request or protocol mismatch. Fallback can add its configured timeout to the primary wait, so worst-case judge latency approaches the sum of both timeouts plus overhead.

The retry has a privacy cost. The primary has already received the unredacted request when it times out, and the fallback receives the same rendered arguments and extracted facts. This can include secrets, command text, and staged file contents. Operators must trust both endpoints and use HTTPS or another protected transport off loopback. API keys authenticate requests but do not encrypt them.

`failMode: "allow"` remains an explicit risk: if both requests fail, the guard allows the call. A successful but unclassifiable response instead follows `unknownMode`. The fallback does not change either behavior or the shared decision thresholds. It is a guardrail availability option, not a security boundary.
