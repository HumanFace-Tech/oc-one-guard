# Design decisions

This document records current design constraints. It is not a chronological decision log. The implementation is the source of truth.

## OpenCode v1-only support

The tested host is OpenCode 1.19.4. The conservative supported range is `>=1.19.4 <2`, without claiming every version in that range was tested. Older versions are unsupported and are not assumed to work. OpenCode v2 is unsupported; this release does not port the runtime hooks or entry point to v2.

The plugin does not import `@opencode-ai/plugin` at runtime. An unused peer dependency would add installation requirements without enforcing host compatibility, so the package omits it. Entry-point JSDoc uses a minimal local structural type for consumed host fields.

## Explicit opt-in installation

Cloning or installing the repository does not activate the plugin. A user must add its local path to either project-level or global OpenCode configuration. Global registration has a wider effect and must remain an explicit user choice. Setup must not edit configuration or create symlinks automatically.

An unregistered or unloaded plugin provides no protection. Fail-closed defaults govern decisions inside the loaded guard, not host registration or load failures. Users must restart OpenCode after registration and check startup logs.

## Fail closed when a decision is required

The defaults block when the judge request fails, the response cannot be classified, or a call falls into the escalation band. This avoids silently treating missing judge output as approval. The prefilter, tool allowlists, and `enabled: false` can allow calls by design, so fail-closed behavior is not an unconditional guarantee.

## Keep the judge boundary visible

The plugin submits rendered tool state to the configured System One endpoint. The endpoint is trusted with that state. Redaction is best-effort and applies to selected audit/error paths, not the judge request. Users must choose an endpoint they trust and protect any audit files.

## Heuristics are not egress controls

Host extraction, command parsing, script tracking, and model classification have bounded or heuristic coverage. The plugin can miss outbound activity and can block legitimate calls. It supplements, but does not replace, operating-system isolation, network egress policy, or review.

## Preserve actionable recovery

The user must be able to disable the plugin without relying on a working OpenCode session. Documentation therefore directs users to stop OpenCode externally and remove the plugin entry from the project or global configuration. `enabled: false` is not full removal because blocked-host checks still run.
