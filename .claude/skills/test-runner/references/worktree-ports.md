# Worktree Port Tracking

Multiple worktrees running tests concurrently can collide on ports (dev server, Docker services,
Playwright). The port registry prevents this.

## Registry Location

The registry lives in the **main repo** (not in worktrees) so all worktrees share it:

```
/media/rikki/recover2/projects/llamenos-hotline/.worktree-ports.json
```

## Schema

```json
{
  "worktrees": {
    "/media/rikki/recover2/projects/llamenos-hotline-cms": {
      "branch": "feat/contact-directory-cms",
      "devServer": 3000,
      "vite": 5173,
      "postgres": 5433,
      "rustfs": 9002,
      "strfry": 7778,
      "registeredAt": "2026-03-31T18:00:00Z"
    },
    "/media/rikki/recover2/projects/llamenos-hotline-sip-bridge-fix": {
      "branch": "fix/sip-bridge-dev",
      "devServer": 3010,
      "vite": 5183,
      "postgres": 5433,
      "rustfs": 9002,
      "strfry": 7778,
      "registeredAt": "2026-03-31T19:00:00Z"
    }
  }
}
```

## Port Allocation Protocol

### When starting work in a worktree

1. Read `.worktree-ports.json` from the main repo
2. Check which ports are in use
3. If your worktree is already registered and ports are free, reuse them
4. If not registered, allocate the next available offset:
   - Base ports (main repo): 3000, 5173, 5433, 9002, 7778
   - Offset +10 per worktree: 3010/5183/5443/9012/7788, then 3020/5193/5453/9022/7798, etc.
5. Write your allocation to the registry

### When tearing down a worktree

1. Remove your entry from `.worktree-ports.json`
2. If using `git worktree remove`, clean up the port entry first

### Shared services

Most worktrees share the same Docker services (postgres on 5433, rustfs on 9002, strfry on 7778)
since they use different databases or hub scoping for isolation. Only the dev server and vite
ports typically need unique allocation.

If a worktree needs its own Docker stack (e.g., testing Docker compose changes), it needs
a full set of unique ports and its own compose project name.

## Stale Entry Cleanup

Entries can go stale if a worktree is removed without cleanup. To detect:

```bash
# List registered worktrees
jq -r '.worktrees | keys[]' .worktree-ports.json

# Check which still exist
git worktree list --porcelain | grep '^worktree ' | awk '{print $2}'
```

Remove entries for worktrees that no longer exist.
