# ADR 0012: Per-session switch for the guard on OpenCode 2.x

**Status:** Accepted for 0.4.0.

## Context

`enabled: false` turns the guard off for every session served by a process, and needs a config edit and a restart. Sometimes a user wants one trusted session to run without review while the rest stay protected.

## Decision

- The OpenCode 2.x adapter registers `/guard.off`, `/guard.on` and `/guard.status` with `ctx.command.transform`. Only the user can run a slash command, so the model cannot switch the guard off.
- The switch is a set of session IDs in memory. A session counts as off when it or any ancestor is in the set, found through `ctx.session.get().parentID`. Subagents therefore follow their parent.
- Fail closed: the default is on, a restart clears the set, an unreadable session keeps the guard on, and `/guard.off` does nothing when the config sets `enabled: false`.
- A call in an off session skips the runtime entirely, so no judge request is made and no file writes are tracked.
- Replies are synthetic notices with `resume: false`, so a command does not wake the model.
- OpenCode 1.x is unchanged.

## Consequences

An off session has no review at all, including for exfiltration. The notice in the conversation is the only record. The set is per plugin instance, so each OpenCode service has its own.
