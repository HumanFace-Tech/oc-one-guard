# 0008 - Scope in-process state to projects

## Decision

Share staged writes, pending mutations, uncertainty, revisions, and judge cache entries only within the same OpenCode project scope. An absolute host `input.worktree` and a project ID identify a scope when the ID is non-global or `project.vcs` is `git`. Empty Git repositories can have ID `global` but still have a real worktree. Use the current input worktree, not the persisted project worktree. Otherwise use the normalized input directory; without an absolute directory, each plugin instance receives a unique scope. Normalization removes trailing separators. Tracked paths outside the root remain owned by the originating scope. Cache keys also retain the effective configuration and credentials. Sensitive state entrypoints require an explicit scope.

## Consequences

Duplicate instances for the same identified project can share evidence and coalesce judge requests. Separate projects do not inherit each other's evidence, uncertainty, or decisions. Uncertainty is not cleared by switching projects. Scope identities depend on the host context and lexical paths; aliases may form separate scopes. This bookkeeping is not a security isolation guarantee or network boundary.
