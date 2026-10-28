# ADR 0002: Keep installation opt-in

**Status:** Accepted

## Context

The guard observes and may block tool calls. Registering it globally would affect every OpenCode project for that user, while a project-level entry affects only one project.

## Decision

Cloning or installing the repository does not activate the plugin. Users explicitly add its local path to project-level or global OpenCode configuration. Setup must not edit configuration or create symlinks automatically.

## Consequences

Users choose the scope where the guard runs and must restart OpenCode and check startup logs after registration. An unregistered or unloaded plugin provides no protection.
