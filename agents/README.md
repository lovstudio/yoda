# Agent Docs

This directory is the system of record for agent-facing repo guidance. Keep topic pages small, specific, and mechanically checkable where possible.

## Recommended Reading Order

1. `quickstart.md`
2. `architecture/overview.md`
3. the task-specific page for the area you are changing

## Directory Layout

- `architecture/`
  - system structure and major code ownership boundaries
  - `mobile.md` covers the Expo app and desktop mobile gateway boundary
  - `extensions.md` covers the Yoda Marketplace, extension permissions, and
    background-service lifecycle
- `workflows/`
  - task-oriented procedures like testing, worktrees, and remote development
- `integrations/`
  - provider, MCP, and external service guidance
- `risky-areas/`
  - places where incorrect changes are expensive
- `conventions/`
  - coding contracts and repo rules

## Maintenance Rules

- Prefer one page per concrete topic.
- Avoid volatile counts unless you can verify them cheaply.
- Link to the source-of-truth file paths.
- Update the smallest relevant page instead of expanding `AGENTS.md`.
