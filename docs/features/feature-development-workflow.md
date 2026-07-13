# Feature loop

Feature loop turns one problem into an ordered delivery package: product design, code, validation, feature documentation, and PR/SEO documentation. Each stage runs in its own agent session, shares the same task worktree, and hands evidence to the next stage through the task's Team Room.

## Start a Feature loop

From Home:

1. Enter the user problem and desired outcome.
2. Open **Development paradigm**.
3. Under **Workflow**, choose **Feature loop**.
4. Review the six stages and team runtimes, then confirm and submit.

From **Create task**:

1. Choose **From branch** or **From issue**.
2. Under **Execution mode**, choose **Feature loop**.
3. Write or review the problem brief. An Issue automatically contributes its title, URL, and description.
4. Configure the branch/worktree and create the task.

Pull-request tasks keep their review-oriented flow; Feature loop is intended to begin from a problem, Issue, or branch.

## The six gates

| Gate | Owner | Required result |
| --- | --- | --- |
| 01 Problem | Feature Lead | User, outcome, non-goals, constraints, success signal, and documentation location |
| 02 Product design | Product Design | PRD, UX flow, UI states, accessibility, edge cases, and acceptance criteria |
| 03 Implementation | Engineering | Working code, focused tests, and recorded technical decisions |
| 04 Validation | Quality | Independent review and exact command results; failures return to Engineering |
| 05 Feature docs | Feature Docs | User-facing behavior, setup, examples, limitations, and troubleshooting |
| 06 PR & SEO | PR & SEO | Reviewer-ready PR/changelog copy and discovery copy, or an explicit SEO N/A reason |

The Feature Lead moves one gate at a time. It checks the actual artifact and evidence before starting the next member. If validation finds a defect, Engineering receives the concrete findings and Quality must validate the revised result again.

## Read the hand-off rail

The numbered rail above the room conversation is rebuilt from saved hand-off messages:

- **Waiting** means a prerequisite has not passed.
- **In progress** means the stage or an approved rework is active.
- **Gate passed** means an ordered pass marker and evidence were saved.
- **Blocked** means the worker reported a durable blocker, currently needs input, or hit an execution error. Explicit blocker hand-offs survive restarts; transient runtime state is recalculated when sessions resume.

Select a stage to open its responsible agent details and session access. The line below the rail shows the latest accepted evidence or the current required deliverable. Because completed gates and explicit blockers come from persisted room history, closing and reopening Yoda does not erase that evidence.

## Artifact behavior

Agents follow the repository's own instructions and documentation layout. If the repository has no feature-doc convention, the Product Design agent uses `docs/features/<feature-slug>/design.md`; later documentation stays beside that feature package. Every hand-off includes concrete artifact paths so the next agent can read the real files rather than relying on a summary alone.

Feature loop prepares PR and SEO documentation but does not automatically push, merge, publish, or create an external PR unless the original request or repository instructions authorize it.

## If the workflow is blocked

- Open the blocked stage to inspect its session and full output.
- Reply in the room or `@` the responsible member with the missing decision.
- For a failed validation, let the Feature Lead send findings back to Engineering, then re-run Quality.
- If an approved design or implementation changes, expect later gates to return to Waiting; this prevents stale test or documentation evidence from remaining green.
