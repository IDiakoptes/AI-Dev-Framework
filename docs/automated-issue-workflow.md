# Automated Issue Development Orchestration

This document describes the **optional** GitHub Actions controller that drives the existing
Planning → Implementation → Review → (Fix → Review)\* → Documentation lifecycle end to end for one
GitHub issue at a time. It implements
[`.github/plans/20260823-ai-issue-development-orchestration.plan.md`](../.github/plans/20260823-ai-issue-development-orchestration.plan.md),
which supersedes the label-only-trigger, deferred-comment scope of
[`.github/plans/20260823-automated-issue-workflow.plan.md`](../.github/plans/20260823-automated-issue-workflow.plan.md).

This feature is disabled until a repository administrator provisions the required label and
secret, and it is installed only when `-IncludeWorkflows` is passed to the installer.

## Explicit limitation of this implementation

The Copilot Agent Tasks REST API used by the controller is public preview and requires a
fine-grained user-to-server credential. Running it end to end (starting a real task, having
Copilot commit to the exact `head_ref`, polling to completion) requires an entitled repository and
that credential. **Neither is available in the environment that produced this implementation.**
The controller and watchdog logic is unit-tested against mocked GitHub REST/Agent Tasks clients
(`.github/scripts/ai-development-controller.test.mjs`); the disposable-repository integration
matrix in the plan's testing section has **not** been executed, and this document does not claim
that it has. The controller fails closed (sets `ai-failed` and posts a redacted, actionable
comment) whenever an API call, task state, or artifact is missing, unexpected, or unknown, rather
than assuming success.

## Prerequisites

1. GitHub Copilot Business or Copilot Enterprise entitlement for the repository (required by the
   Agent Tasks API).
2. A repository administrator has created the permanent `ai-development` label (the controller can
   also idempotently ensure it and the seven state labels on first authorized run).
3. A fine-grained personal access token or GitHub App user access token with **Agent Tasks**
   read/write permission, stored as the repository secret `COPILOT_AGENT_TOKEN`. Installation
   tokens and the default `GITHUB_TOKEN` are not supported by Agent Tasks.
4. This workflow installed via `./scripts/install-ai-framework.ps1 -IncludeWorkflows` (or copied
   manually), because the installer never enables issue automation silently.

## Enablement

Add the exact `ai-development` label to an issue, either when opening it or afterward. Adding any
other label, or a case-variant label, never starts the controller. Only a repository collaborator
with `write`, `maintain`, or `admin` permission can authorize a run; the controller re-checks the
acting user's permission on every entry point, including issues opened with the label already
present.

## Workflows

- **`.github/workflows/ai-development.yml`** — the controller. Triggers on `issues: [opened,
  labeled]`, plus maintainer-only `workflow_dispatch` and reusable `workflow_call` resume paths
  that always re-fetch the issue and require the exact permanent label before doing anything.
- **`.github/workflows/ai-development-watchdog.yml`** — a `workflow_run: completed` watchdog
  scoped to the controller workflow. It never checks out or executes pull-request content; it only
  reads the completed run's conclusion and name to recover from a cancelled, timed-out, or crashed
  controller run that could not perform its own cleanup.
- **`.github/scripts/ai-development-controller.mjs`** — the API/state-machine implementation,
  covered by **`.github/scripts/ai-development-controller.test.mjs`** (`node --test`).

## Permissions and secrets

| Workflow | `GITHUB_TOKEN` permissions | Other secrets |
|---|---|---|
| Controller | `contents: write`, `issues: write`, `pull-requests: write`; every other scope `none` | `COPILOT_AGENT_TOKEN` (Agent Tasks read/write only) |
| Watchdog | `actions: read`, `contents: read`, `issues: write`, `pull-requests: read`; every other scope `none` | none |

Neither workflow requests `id-token`, administration, or merge-capable permissions. The
`COPILOT_AGENT_TOKEN` is never reused as, and never substitutes for, `GITHUB_TOKEN`.

## Configuration

- `AI_DEVELOPMENT_MAX_ITERATIONS` (repository variable): maximum number of change-request/fix/
  re-review cycles. Accepts an integer from `0` through `10`; defaults to `3` when unset. Any
  other value fails the run closed rather than silently falling back.
- Repository context and Copilot instructions (`templates/repository-context.md`,
  `templates/copilot-instructions.md`) still define the repository-specific build/test/approval
  policy the specialist agents use; the controller does not duplicate that knowledge.

## State model

Every issue that opts in carries the permanent `ai-development` label plus **exactly one** of the
following active-state labels:

| Label | Meaning |
|---|---|
| `ai-planning` | Planning Agent task running |
| `ai-implementation` | Implementation Agent task running |
| `ai-review` | Code Review Agent task running |
| `ai-changes-requested` | Bounded remediation requested by review; restarts implementation |
| `ai-documentation` | Documentation Agent task running |
| `ai-complete` | Lifecycle finished; pull request awaits human review/merge |
| `ai-failed` | Lifecycle stopped without completing; needs maintainer action |

```
(no label) --qualify--> ai-planning --planApproved--> ai-implementation
  --implementationComplete--> ai-review
      --approved--> ai-documentation --documented--> ai-complete
      --changesRequested--> ai-changes-requested --remediationStart--> ai-implementation
  (any active state) --error--> ai-failed
```

Every transition preserves unrelated labels and the permanent `ai-development` marker, replaces
only the active-state label, and re-reads the result to verify exactly one active label remains;
a mismatch fails the run closed instead of continuing with an unverified label set.

## Duplicate protection and resumability

- Actions concurrency is keyed by repository ID and issue number (`cancel-in-progress: false`), so
  an in-progress run is never cancelled by a second qualifying event.
- The controller re-reads the issue's current labels and a durable, idempotent, HTML-marked
  controller-state PR comment (schema version, issue number, branch, PR number, phase, task ID,
  head SHA, review iteration) before acting, so repeated or resumed runs do not create duplicate
  branches, pull requests, or Agent Tasks.
- An issue that already carries a terminal label (`ai-complete` or `ai-failed`) is a no-op on any
  further qualifying event. Recovery after `ai-failed` requires a maintainer to remove the terminal
  label and use `workflow_dispatch` explicitly; there is no automatic retry.

## Branch and pull request conventions

- Branch name: exactly `ai/issue-<number>-<slug>`, where `<slug>` is a lowercase ASCII slug of the
  issue title (hyphen-separated, capped at 48 characters, `task` when empty). The first computed
  branch name is persisted, so a later issue title edit cannot rename it.
- The controller creates this branch (with a trace commit) and opens one draft pull request before
  starting any Agent Task, then passes both `base_ref` and `head_ref` so Copilot commits to that
  exact branch instead of creating a new `copilot/` branch.
- The pull request links the issue and remains open; **nothing in this repository merges,
  auto-merges, or approves it**. `ai-complete` means the AI lifecycle finished, not that the
  change was merged.

## Review cap and documentation outcome

- Each `CHANGES REQUESTED` verdict restarts implementation and review, up to
  `AI_DEVELOPMENT_MAX_ITERATIONS` cycles (default `3`). Reaching the cap sets `ai-failed`.
- Only an exact `APPROVED` verdict starts the Documentation Agent task.
- The documentation task's committed diff is classified as exactly one of **CREATE**, **UPDATE**,
  or **NO CHANGE** (reorganization is treated as **UPDATE**). Any change outside a documentation
  path during this stage fails the run closed.

## Comments

- One idempotent completion comment is posted when the issue reaches `ai-complete`, and one
  idempotent failure comment when it reaches `ai-failed`. Both carry a stable HTML marker so a
  retry updates or no-ops rather than duplicating the comment.
- Comments never include raw tokens, authorization headers, or full API responses; values are
  redacted before being written.

## Troubleshooting and rollback

- **Nothing happens after adding the label**: confirm the label name is exactly `ai-development`
  (case-sensitive), the acting user has `write`/`maintain`/`admin` permission, and
  `COPILOT_AGENT_TOKEN` is configured.
- **Run stopped with `ai-failed`**: read the posted failure comment for the redacted reason (for
  example, an unknown Agent Tasks state, a missing plan/review artifact, or an exhausted review
  cap). Address the underlying cause, remove the `ai-failed` label, and re-run via
  `workflow_dispatch` with the issue number.
- **Controller run was cancelled or timed out**: the watchdog workflow sets `ai-failed` and posts
  the failure comment automatically; no manual label edit is required before investigating.
- **Disabling automation**: remove the `ai-development` label (existing state labels remain for
  audit history) and/or delete the two workflow files; no other framework file depends on them.

## Platform limitations that remain out of this implementation's control

- Agent Tasks is public preview and can change; the controller pins the documented API version
  header and fails closed on unknown fields or states rather than guessing.
- GitHub label updates are not a multi-label transaction; the controller serializes its own runs
  and verifies the result, but cannot guarantee atomicity against a simultaneous human/app edit.
- A bot-authored review verdict is lifecycle evidence only. It cannot substitute for a
  human/ruleset-enforced required approval, and repository CI on Copilot-authored commits is not
  guaranteed to run automatically under GitHub's default approval controls.
