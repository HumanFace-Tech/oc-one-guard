# ADR 0005: Treat detection as a heuristic

**Status:** Accepted

## Context

Host extraction, command parsing, staged-file tracking, and model classification have bounded or heuristic coverage. Tools and child processes can open network connections outside the observed tool-call path.

## Decision

Describe the plugin as a heuristic guardrail, not a sandbox or network egress firewall. Keep limitations visible and recommend separate OS isolation, network egress controls, or human review for stronger controls.

## Consequences

The plugin may miss exfiltration attempts and may block legitimate calls. Tests can establish specific behavior but cannot guarantee comprehensive detection.
