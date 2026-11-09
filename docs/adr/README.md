# Architecture decision records

These records describe accepted design constraints. The implementation and tests remain the source of truth for current behavior.

- [0001 - Support OpenCode v1 only (superseded by 0011)](0001-opencode-v1-only.md)
- [0002 - Keep installation opt-in](0002-opt-in-installation.md)
- [0003 - Block when judgment fails or is unclear](0003-fail-closed-judgments.md)
- [0004 - Keep the judge boundary visible](0004-visible-judge-boundary.md)
- [0005 - Treat detection as a heuristic](0005-heuristic-not-egress-control.md)
- [0006 - Preserve an external disable path](0006-external-disable-path.md)
- [0007 - Risk bands and best-effort run cancellation](0007-risk-bands-and-run-cancellation.md)
- [0008 - Scope in-process state to projects](0008-project-state-scoping.md)
- [0009 - Adopt the E02 default question](0009-e02-default-question.md)
- [0010 - Use fallback only after a primary timeout](0010-timeout-only-fallback.md)
- [0011 - Support OpenCode 2.x through a shared core and host adapters](0011-opencode-v2-adapter.md)
- [0012 - Per-session switch for the guard on OpenCode 2.x](0012-session-toggle.md)
