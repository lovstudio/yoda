# Feature loop launch packet

## Pull request

### Title

Add a gated end-to-end Feature development workflow

### Body

## Problem

Yoda's Spec, Review, and Agent Team modes cover individual parts of feature development, but they do not preserve one ordered contract from problem definition through product/UI design, implementation, independent testing, feature documentation, and PR/SEO copy.

## Solution

- Add a built-in Feature team with a strict sequential routing mode and six artifact-backed gates.
- Persist compact PASS/BLOCKED markers in existing Team Room hand-offs and rebuild progress after reload without a database migration.
- Surface Feature as a first-class Home workflow and as an execution mode for branch/Issue task creation.
- Add a responsive, keyboard-accessible 01–06 hand-off rail with real evidence, blockers, owners, and member-session navigation.
- Invalidate downstream gates whenever an upstream artifact is re-passed, and route validation failures back through Engineering and Quality.
- Document the feature, interaction contract, limitations, and launch/SEO material.

## UX

The signature element is a numbered hand-off spine rather than a generic checklist. It uses existing Yoda tokens and typography, exposes text status in addition to color, wraps at narrow widths, and marks the active item with `aria-current="step"`.

## Verification

- Focused shared protocol/team tests cover stage order, malformed and out-of-order hand-offs, blocker state, rework invalidation, live state, and the fixed team contract.
- Repository gates: `pnpm run format`, `pnpm run lint`, `pnpm run typecheck`, and `pnpm test`.
- Production verification: the Yoda application build plus the separate `yoda-docs` typecheck, production build, and rendered route smoke test.

## Risk and compatibility

- No database schema or numbered migration changes.
- Existing Task lifecycle statuses remain unchanged.
- Standard, Spec, Review, Startup, custom-team, and pull-request flows retain their existing behavior.
- External PR creation, merge, and publishing remain authorization-bound; the final stage prepares the package by default.

## Changelog

Add Feature loop, a six-stage problem-to-launch workflow that coordinates product design, implementation, independent validation, feature docs, and PR/SEO copy with durable hand-off gates.

## SEO

- Title: `Yoda Feature Loop: From Problem to PR with AI Agents`
- Meta description: `Ship features with Yoda's gated AI workflow for product design, coding, testing, user docs, and PR/SEO hand-offs in one traceable task.`
- Suggested slug: `feature-loop`
- Primary keywords: `AI feature development workflow`, `multi-agent coding workflow`, `AI product development`, `AI code review and documentation`
- Search intent: developers and product teams looking for an AI workflow that carries a feature from discovery through verified delivery rather than stopping at code generation.

## Announcement copy

Give Yoda one problem. Feature loop carries it through product and UI design, implementation, independent tests, feature docs, and a reviewer-ready PR/SEO package. Every explicit gate hand-off keeps its artifacts and evidence, so verified progress and recorded blockers survive rework and app restarts.
