# ADR 0001: Support OpenCode v1 only

**Status:** Accepted

## Context

The plugin entry point and hooks target OpenCode v1. Version 1.19.4 is tested; the conservative supported range is `>=1.19.4 <2`. The entry point uses a local structural type for the host fields it consumes and does not import the plugin SDK at runtime.

## Decision

Support OpenCode v1 only. Do not claim compatibility with older versions or OpenCode v2. The stated range does not mean every version in it has been tested.

## Consequences

The plugin avoids adding an unused runtime peer dependency, but that does not validate host compatibility. A v2 port and tests would be needed before claiming v2 support.
