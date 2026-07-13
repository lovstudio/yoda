# Skill detail sidebar

## Goal

Make repeated skill browsing faster without duplicating the catalog or skill actions inside the detail page.

## Design

Use a master-detail layout at wide container sizes. A compact 240px navigation rail sits to the left of the existing detail content. It inherits the catalog tab that opened the detail, so an installed detail lists only installed skills and a recommended detail lists only recommendations. It contains a sticky search field and a dense alphabetical list. The active skill uses the existing neutral selected background plus a narrow leading rail, so selection remains visible without introducing a new accent system.

When a detail opens or changes, the rail scrolls the active skill into the center of the visible list and briefly applies the same amber focus ring used by the catalog. The transient emphasis fades while the persistent selected background and leading rail remain.

Selecting a skill uses the existing skill-tab navigation. An already-open detail is focused and a new skill opens as a deduplicated detail tab, preserving Yoda's established comparison model. Installation, disablement, editing, and other entity actions remain in the shared detail components.

Right-clicking another skill offers two distinct actions. “Compare SKILL.md” opens a deduplicated skill-scope tab backed by the same Monaco side-by-side diff configuration used for Git files, including line and word changes, synchronized scrolling, and collapsed unchanged regions. “Open in side pane” remains a quick way to inspect two complete detail pages at once.

At narrow container widths the rail is hidden and the existing detail layout remains unchanged. The app tab strip continues to provide navigation in that constrained host.

## Verification

- Search matches display name, directory ID, and description.
- Current skill is exposed with `aria-current`.
- The rail responds to its actual host width through a container query.
- Existing skill tabs remain the source of truth for opening and comparison.
