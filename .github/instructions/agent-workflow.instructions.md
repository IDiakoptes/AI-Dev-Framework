# Agent Workflow Instructions

## Lifecycle
1. User Request
2. Planning Agent creates/updates plan in `.github/plans/`
3. Implementation Agent executes approved plan
4. Code Review Agent evaluates implementation and writes review in `.github/reviews/`
5. If verdict is **CHANGES REQUESTED**, Implementation Agent addresses findings and returns to review
6. If verdict is **APPROVED**, Documentation Agent updates docs
7. Done

## Iteration Control
- Default maximum review/fix iterations: **3**
- After max iterations, require human decision: reduce scope, clarify requirements, or approve exception.

## Traceability
- Every implementation should reference a plan artifact.
- Every review should reference requirements, plan, and changed files.
- Decisions should be evidence-based and repository-specific.

## Repository Context
- If `.github/repository-context.md` exists, agents should read it before making decisions.
- If absent, agents must infer only from observable repository files and user input.

## Automated Issue Development Orchestration (Optional)
- An opt-in GitHub Actions controller (`.github/workflows/ai-development.yml`) can drive this same
  lifecycle end to end for one issue at a time, starting only when the exact `ai-development` label
  is present on issue creation or is later added.
- The controller is a deterministic Actions script
  (`.github/scripts/ai-development-controller.mjs`), not a fifth agent. It calls the existing
  Planning, Implementation, Code Review, and Documentation agents directly through the Copilot
  Agent Tasks API against one exact `ai/issue-<number>-<slug>` branch and its draft pull request.
- The issue carries the permanent `ai-development` marker plus exactly one active-state label:
  `ai-planning`, `ai-implementation`, `ai-review`, `ai-changes-requested`, `ai-documentation`,
  `ai-complete`, or `ai-failed`. Agents must not remove `ai-development` or add a second active
  label themselves; the controller owns label transitions.
- The same review/fix iteration control applies: the controller reads
  `AI_DEVELOPMENT_MAX_ITERATIONS` (default `3`, maximum `10`) and stops with `ai-failed` once the
  cap is reached, matching the manual "Iteration Control" rule above.
- Documentation still runs only after an **APPROVED** verdict, and the controller records the
  Documentation Agent's outcome as exactly one of **CREATE**, **UPDATE**, or **NO CHANGE**.
- `ai-complete` means the automated lifecycle finished and left an open pull request for human
  review; it never means the pull request was merged. No workflow in this repository merges,
  auto-merges, or approves a pull request on an agent's behalf.
- See `docs/automated-issue-workflow.md` for enablement, required labels/secrets, and
  troubleshooting.
