# ADR 0006: Preserve an external disable path

**Status:** Accepted

## Context

The default failure policy can block tool calls when the configured judge is unavailable. A user may then be unable to rely on the OpenCode session itself to change settings.

## Decision

Document a disable path that does not depend on the running session: stop OpenCode externally and remove the plugin entry from project or global configuration. Do not describe `enabled: false` as full removal because blocked-host scanning still runs.

## Consequences

Users can recover from a blocked session by editing configuration outside the TUI. The plugin remains explicitly installed only until that configuration entry is removed.
