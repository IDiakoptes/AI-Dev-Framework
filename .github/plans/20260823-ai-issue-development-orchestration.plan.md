# AI Issue Development Orchestration Plan

Status: Approved
Date: 2026-08-23

## Task summary

Add an optional, reusable GitHub issue orchestration path that starts only when the exact
`ai-development` label is present on issue creation or is later added. A GitHub Actions
controller must retain that label as a permanent identifier, expose one active-state label, call
the repository's four existing specialist agents through the Copilot Agent Tasks API, use an
exact `ai/issue-<number>-<slug>` pull-request branch, enforce evidence-based review and bounded
rework, run documentation only after approval, leave merging to a human, and report terminal
success or failure without exposing secrets.

This plan reconciles and supersedes only the conflicting parts of
`.github/plans/20260823-automated-issue-workflow.plan.md`; it does not replace the existing
specialist-agent or artifact conventions.

## Repository findings

### Complete repository inventory

#### Root and repository policy

- `README.md`
- `.gitignore`
- `.github/repository-context.md` — not present
- `.github/copilot-instructions.md` — not present

#### Reusable agent profiles

- `.github/agents/planning-agent.agent.md`
- `.github/agents/implementation-agent.agent.md`
- `.github/agents/code-review-agent.agent.md`
- `.github/agents/documentation-agent.agent.md`

#### Reusable instruction files

- `.github/instructions/agent-workflow.instructions.md`
- `.github/instructions/documentation.instructions.md`
- `.github/instructions/security.instructions.md`
- `.github/instructions/testing.instructions.md`

#### Plans and reviews

- `.github/plans/README.md`
- `.github/plans/20260823-automated-issue-workflow.plan.md`
- `.github/reviews/README.md`

#### GitHub Actions

- `.github/workflows/framework-validation.yml`

#### Documentation

- `docs/agents.md`
- `docs/architecture.md`
- `docs/configuration.md`
- `docs/customization.md`
- `docs/installation.md`
- `docs/workflow.md`

#### Templates

- `templates/copilot-instructions.md`
- `templates/repository-context.md`

#### Installation

- `scripts/install-ai-framework.ps1`

#### Local hidden Git metadata

- `.git/HEAD`
- `.git/FETCH_HEAD`
- `.git/config`
- `.git/description`
- `.git/index`
- `.git/info/exclude`
- `.git/packed-refs`
- `.git/shallow`
- `.git/logs/HEAD`
- `.git/logs/refs/heads/copilot/setup-automated-issue-workflow`
- `.git/refs/heads/copilot/setup-automated-issue-workflow`
- `.git/copilot-hooks/prepare-commit-msg`
- `.git/hooks/applypatch-msg.sample`
- `.git/hooks/commit-msg.sample`
- `.git/hooks/fsmonitor-watchman.sample`
- `.git/hooks/post-update.sample`
- `.git/hooks/pre-applypatch.sample`
- `.git/hooks/pre-commit.sample`
- `.git/hooks/pre-merge-commit.sample`
- `.git/hooks/pre-push.sample`
- `.git/hooks/pre-rebase.sample`
- `.git/hooks/pre-receive.sample`
- `.git/hooks/prepare-commit-msg.sample`
- `.git/hooks/push-to-checkout.sample`
- `.git/hooks/sendemail-validate.sample`
- `.git/hooks/update.sample`
- `.git/objects/pack/pack-813a96845799ce953f3ada1b8f9272f6c6b04eee.idx`
- `.git/objects/pack/pack-813a96845799ce953f3ada1b8f9272f6c6b04eee.pack`
- `.git/objects/pack/pack-813a96845799ce953f3ada1b8f9272f6c6b04eee.rev`

The `.git` hook samples are stock Git examples. The local Copilot hook only adds a co-author
trailer; none of these files implements repository issue orchestration.

## Current state

### Confirmed facts and evidence

- The repository is a reusable, technology-agnostic framework whose repository-specific
  knowledge belongs in repository context and Copilot instructions (`README.md:3-17`,
  `README.md:41-45`, `README.md:78-79`, `docs/architecture.md:5-16`,
  `docs/configuration.md:9-18`).
- The documented lifecycle is currently manual:
  `Plan → Implement → Review → (Fix → Review)* → Document`, with a default review/fix limit of
  three (`README.md:46-49`, `README.md:59-63`, `docs/workflow.md:3-13`,
  `.github/instructions/agent-workflow.instructions.md:3-23`).
- Planning is read-only and evidence-based
  (`.github/agents/planning-agent.agent.md:6-46`).
- Implementation requires an approved plan and executed validation
  (`.github/agents/implementation-agent.agent.md:6-37`).
- Review is evidence-based and ends in `APPROVED` or `CHANGES REQUESTED`
  (`.github/agents/code-review-agent.agent.md:16-44`,
  `.github/reviews/README.md:8-15`).
- Documentation runs after approval. Its current classifications are `CREATE`, `UPDATE`,
  `NO CHANGE`, and `REORGANIZE`
  (`.github/agents/documentation-agent.agent.md:16-26`,
  `.github/instructions/documentation.instructions.md:9-13`).
- Plans and reviews already have dated artifact conventions (`README.md:51-57`,
  `.github/plans/README.md:5-21`, `.github/reviews/README.md:5-15`).
- The only repository-authored workflow validates pull requests or manual dispatch, grants
  `contents: read`, and checks required files, unresolved placeholders, and PowerShell syntax
  (`.github/workflows/framework-validation.yml:3-8`,
  `.github/workflows/framework-validation.yml:17-42`).
- The installer copies framework files and copies workflows only when `-IncludeWorkflows` is
  supplied (`scripts/install-ai-framework.ps1:83-107`).
- Existing policy forbids stored credentials and requires least privilege
  (`README.md:64-67`, `.github/instructions/security.instructions.md:3-18`,
  `templates/copilot-instructions.md:12-27`, `.gitignore:6-13`).
- No issue-triggered workflow, coordinator agent, operations guide, repository context, or
  repository-level Copilot instructions currently exists.

### Existing related plan

`.github/plans/20260823-automated-issue-workflow.plan.md` is unimplemented. It proposes:

- optional label-driven orchestration (`:5-12`);
- only an `issues:labeled` entry path (`:26-31`);
- one coordinator while preserving all four specialist agents (`:210-224`);
- exact-label gating, per-issue concurrency, assignee precheck, least privilege, and no checkout
  (`:228-247`);
- a coordinator, issue workflow, and operations documentation (`:262-338`);
- validation, installer, template, and documentation updates (`:342-437`);
- preservation of specialist agents and artifact conventions (`:439-450`);
- open questions around plan approval, custom-agent identity, relabeling, and failure reporting
  (`:645-677`);
- no state labels or issue comments in its first version (`:664-667`).

## Current official platform findings

The following was re-verified against current official GitHub documentation on 2026-08-23.
These platform facts replace older assumptions in the prior plan.

### Supported mechanisms

1. Actions supports `issues` activity types `opened` and `labeled`. If an issue opens with two
   labels, GitHub starts one `opened` run and two `labeled` runs. `on.issues.types` cannot filter
   a label name, so the workflow must use event-specific job conditions:
   - `opened`: exact membership test against `github.event.issue.labels`;
   - `labeled`: `github.event.label.name == 'ai-development'`.
   [Workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onevent_nametypes)
2. Actions `concurrency` serializes work by a group expression, but ordering is not guaranteed
   and only one running plus one pending run is retained. Concurrency is therefore necessary but
   not sufficient; durable issue/branch/PR/task identity checks remain required.
   [Concurrency](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency)
3. The public-preview Agent Tasks REST API can start a task with an exact custom-agent identifier,
   where the identifier is the `.github/agents/<name>.agent.md` filename without its extension.
   It exposes task IDs, task/session states, errors, and branch/PR artifacts through create/get/list
   endpoints. Supported states include `queued`, `in_progress`, `completed`, `failed`, `idle`,
   `waiting_for_user`, `timed_out`, and `cancelled`.
   [Agent Tasks REST API](https://docs.github.com/en/rest/agent-tasks/agent-tasks)
4. Agent Tasks supports both `base_ref` and `head_ref`. When both identify an existing open PR,
   Copilot commits to that exact head branch instead of creating a new `copilot/` branch. The
   controller can therefore create `ai/issue-<number>-<slug>` and its draft PR first, then start
   each specialist task against that PR.
   [Start an agent task](https://docs.github.com/en/rest/agent-tasks/agent-tasks#start-a-task)
5. Agent Tasks requires a user-to-server credential: a fine-grained PAT or GitHub App user access
   token with Agent Tasks read/write. Installation/server-to-server tokens and ordinary
   `GITHUB_TOKEN` are not supported for starting tasks.
   [Using cloud agent via API](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api)
6. Custom agents can invoke other custom agents with the `agent` tool alias, but this design does
   not depend on probabilistic in-agent handoff. Actions starts `planning-agent`,
   `implementation-agent`, `code-review-agent`, and `documentation-agent` explicitly and checks
   each task result.
   [Custom-agent tools](https://docs.github.com/en/copilot/reference/custom-agents-configuration#tools)
7. The pull-request review REST endpoint accepts `APPROVE`, `REQUEST_CHANGES`, and `COMMENT`.
   However, an author cannot approve its own PR, the user who assigned Copilot cannot approve the
   resulting PR, Copilot cannot approve or merge, and requested changes only block merging when a
   ruleset/branch-protection rule enforces them.
   [Review API](https://docs.github.com/en/rest/pulls/reviews#create-a-review-for-a-pull-request);
   [required-review restrictions](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews)
8. Copilot can run validation in its environment, but workflows on Copilot changes are held for a
   writer's **Approve and run workflows** action by default. The controller must not equate an
   agent verdict with a required human approval or claim that repository CI ran when it did not.
   [Cloud-agent risks and mitigations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations)
9. Reusable workflows must live directly under `.github/workflows` and declare `workflow_call`.
   This repository can remain technology-agnostic by keeping orchestration generic and delegating
   repository-specific validation discovery to repository context and the specialist agents.
   [Reusable workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)
10. GitHub recommends least-privilege tokens, secret masking, avoiding untrusted expressions in
    generated shell source, and never checking out untrusted PR code in a privileged
    `pull_request_target` or `workflow_run` job.
    [Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)

### What cannot be fully deterministic or automatic

- AI output, correctness, task duration, and compliance with an artifact format remain
  probabilistic. The controller can only validate observable outputs and fail closed.
- Agent Tasks is public preview and has no documented completion webhook. Polling the documented
  task state is supported, but Actions runner limits, cancellation, API outages, and
  `waiting_for_user` can interrupt an otherwise valid run.
- GitHub label updates are not a multi-label transaction. The controller can serialize its own
  runs, remove all known state labels, add the target, re-read, and retry, but cannot guarantee
  atomic visibility or prevent a simultaneous human/app label edit.
- Actions concurrency does not provide FIFO ordering or durable business idempotency.
- A bot-authored evidence verdict cannot serve as the PR author's native approval. Native required
  approval remains a distinct human or separately governed reviewer identity.
- Repository CI on Copilot commits is not guaranteed to run automatically under GitHub's default
  approval controls. The agent must report validation it actually ran; external required checks
  remain a human-controlled merge gate.
- The framework cannot guarantee entitlement, model availability, organization policy, API
  preview stability, token validity, rate limits, or Actions/Copilot service availability.

## Desired state and gap analysis

| Requirement | Current behavior | Required change |
|---|---|---|
| Exact opt-in on `opened` with label already present or exact label `labeled` | No issue workflow; prior plan supports only `labeled` | Add both events and event-specific exact guards |
| Permanent `ai-development` identifier | Mentioned only in the prior plan; label is not provisioned | Define one canonical marker and never remove it during transitions |
| Mutually exclusive active labels | Not implemented; prior plan deferred them | Define and enforce exactly one of the seven requested state labels |
| Deterministic transitions | Manual lifecycle only | Add compare-before-transition rules, terminal behavior, and verified label replacement |
| Duplicate protection | Prior plan only | Preserve concurrency and assignee checks; add state/PR identity checks for both entry paths |
| `ai/issue-<number>-<slug>` branch | Not implemented or covered by prior plan | Verify platform control, then enforce normalized deterministic naming |
| Traceable PR | Existing artifacts only | Link issue, branch, plan, review, checks, and terminal result in PR/issue records |
| No auto-merge by default | No merge automation exists | Keep workflow free of merge operations and document human merge boundary |
| Evidence-based verdict | Already supported | Reuse the existing review agent and canonical verdicts |
| Configurable max iterations, default 3 | Default documented, no automated reader/counter | Define precedence, durable counter, and cap behavior |
| Docs only after approval; `CREATE`/`UPDATE`/`NO CHANGE` | Gate exists; a fourth classification also exists | Use exactly the three requested top-level outcomes; treat reorganization as `UPDATE` |
| Completion/failure comments | Not implemented; prior plan deferred comments | Add idempotent terminal comments and failure fallback |
| Least privilege/no secret exposure | Policy exists | Apply it to workflow permissions, token handling, API payloads, and logs |
| Reusable/technology-agnostic | Already a core principle | Keep orchestration generic and let repository context define build/test details |

## Architecture impact

Add one deterministic Actions controller, not a fifth agent:

1. The controller qualifies and authorizes the issue event, ensures labels, and serializes by
   repository/issue number.
2. It creates the exact branch with a trace commit, opens one draft PR with stable issue and
   machine markers, and persists controller state in an idempotently updated PR comment.
3. It calls the public-preview Agent Tasks API separately for the four existing custom-agent
   filenames using the PR's `base_ref` and exact `head_ref`.
4. Before each task it applies the corresponding state label. After each task it polls the
   documented state, records the task ID/head SHA, and validates the expected committed artifact
   or diff without executing content from the PR branch.
5. It parses the review artifact's one exact terminal verdict. `CHANGES REQUESTED` starts a
   bounded implementation/re-review cycle; `APPROVED` is the only route to documentation.
6. It derives documentation outcome from the pre/post documentation diff:
   - `NO CHANGE`: no documentation diff;
   - `CREATE`: one or more documentation files added and no existing documentation changed;
   - `UPDATE`: any existing documentation changed/renamed/deleted, including mixed add/update or
     reorganization.
   Any application-code change during the documentation task fails closed.
7. A separate no-checkout `workflow_run` watchdog handles controller cancellation/failure/timeout
   and posts one idempotent failure result when the main controller cannot run its own cleanup.
8. Existing plan/review artifacts remain the durable evidence record. `ai-complete` means the AI
   lifecycle finished and the open PR is ready for human disposition; it does not mean merged.

### State model

- Permanent marker: `ai-development`.
- Active state, exactly one:
  - `ai-planning`
  - `ai-implementation`
  - `ai-review`
  - `ai-changes-requested`
  - `ai-documentation`
  - `ai-complete`
  - `ai-failed`

Allowed transitions:

1. Qualified trigger with no existing orchestration identity → `ai-planning`.
2. Approved/non-blocked plan → `ai-implementation`.
3. Implementation and required checks complete → `ai-review`.
4. `CHANGES REQUESTED` below iteration cap → `ai-changes-requested`.
5. Accepted remediation start → `ai-implementation`.
6. `APPROVED` → `ai-documentation`.
7. Documentation outcome `CREATE`, `UPDATE`, or `NO CHANGE` → `ai-complete`.
8. Blocked plan, unrecoverable error, invalid verdict, validation failure that cannot be
   remediated, or exhausted review iterations → `ai-failed`.

Every transition must verify the expected current state, preserve all unrelated labels and
`ai-development`, replace the active-state set, re-read labels, and fail closed if the invariant
is not satisfied. Terminal relabel events are no-ops unless an explicit, separately documented
retry mechanism is adopted.

### Duplicate and durability model

- Workflow concurrency key: repository ID plus issue number; do not cancel an in-progress run.
- On either event path, no-op when the issue already has an active/terminal state, the intended
  canonical PR, or persisted controller/task identity.
- Use issue number as the primary identity and one normalized slug only for human-readable
  artifact and branch names.
- Persist schema version, issue number, branch, PR number, phase, task ID, head SHA, and review
  iteration in one stable HTML-marked PR comment; do not rely on runner memory.
- Define the maximum as the number of change-request/fix/re-review cycles. Use repository
  configuration when present and otherwise default to `3`.
- Terminal comments must carry a stable machine marker so retries update or no-op rather than
  posting duplicates.
- Normalize slugs as lowercase ASCII alphanumerics separated by one hyphen, trim leading/trailing
  hyphens, cap the slug component at 48 characters, and use `task` when empty. Persist the first
  computed branch so later title edits cannot rename it.

## Files to create

### `.github/workflows/ai-development.yml`

Create the opt-in controller workflow:

- `issues: [opened, labeled]`;
- `opened` qualifies only when the issue's current labels contain exact `ai-development`;
- `labeled` qualifies only when `github.event.label.name == 'ai-development'`;
- `workflow_dispatch` accepts an issue number for an explicit maintainer resume;
- `workflow_call` accepts the same typed issue number and explicitly declared Agent Tasks secret;
  every non-`issues` entry re-fetches the issue and requires the permanent opt-in label;
- per-issue concurrency with `cancel-in-progress: false`;
- exact collaborator-permission authorization (`write`, `maintain`, or `admin`);
- job-level `contents: write`, `issues: write`, and `pull-requests: write`, with every other
  `GITHUB_TOKEN` permission set to `none`;
- a minimally scoped user-to-server secret only for Agent Tasks;
- trusted-default-branch checkout with credentials disabled; no PR-head checkout or execution;
- bounded polling and an `always()` cleanup path;
- preflight/resume checks that make repeated events idempotent.

### `.github/workflows/ai-development-watchdog.yml`

Create a `workflow_run: completed` watchdog scoped to the controller workflow. It must use the
issue number in the fixed run name, never checkout or execute PR content, no-op successful or
already-terminal runs, and set `ai-failed` plus the stable failure comment for cancelled, timed
out, or failed runs that left nonterminal controller state.

### `.github/scripts/ai-development-controller.mjs`

Implement the API controller with no package dependency. Export pure helpers for trigger
qualification, authorization-result handling, slugging, state transitions, label reconciliation,
markers, iteration limits, review-verdict parsing, documentation diff classification, and
terminal comment construction. Keep API calls typed/validated, bounded, redacted, and resumable.

### `.github/scripts/ai-development-controller.test.mjs`

Use Node's built-in test runner and mocked API boundaries to cover pure rules and controller
failure paths without network access or credentials.

### `docs/automated-issue-workflow.md`

Document prerequisites, label provisioning, enablement, permissions/secrets, configuration
precedence, state diagram, duplicate/retry behavior, branch/PR conventions, review cap,
documentation outcomes, comments, troubleshooting, rollback, no-auto-merge behavior, and
platform limitations.

## Files to modify

- `.github/workflows/framework-validation.yml` — validate both workflows, controller/tests,
  operations guide, triggers, labels, permissions, immutable action pins, and forbidden
  merge/unsafe interpolation.
- `.github/instructions/agent-workflow.instructions.md` — add automated state/handoff rules
  without duplicating specialist instructions.
- `.github/instructions/security.instructions.md` — cover event-payload safety, token masking,
  label/comment writes, and fail-closed behavior.
- `.github/agents/documentation-agent.agent.md` — make the orchestration-facing result exactly
  `CREATE`, `UPDATE`, or `NO CHANGE`; classify reorganization under `UPDATE`.
- `scripts/install-ai-framework.ps1` — copy the operations guide by default and both workflows
  plus their controller/test files only with `-IncludeWorkflows`.
- `README.md` — describe optional automation, trigger semantics, lifecycle, and no-auto-merge.
- `docs/agents.md` — document direct controller selection of the four existing specialists and
  explicitly state that there is no fifth coordinator agent.
- `docs/architecture.md` — add the optional event/controller/state layer.
- `docs/configuration.md` — define label constants, max-iteration precedence/default, and token
  configuration.
- `docs/customization.md` — document safe customization boundaries and retry policy.
- `docs/installation.md` — add label, secret, workflow, and Copilot capability setup.
- `docs/workflow.md` — add the deterministic automated state machine alongside the manual flow.
- `templates/copilot-instructions.md` — expose orchestration/no-auto-merge expectations.
- `templates/repository-context.md` — expose the max-iteration override and approval policy.

Preserve without duplication:

- `.github/agents/planning-agent.agent.md`
- `.github/agents/implementation-agent.agent.md`
- `.github/agents/code-review-agent.agent.md`
- Do not create an orchestration/coordinator agent; the controller selects these existing
  filenames directly.
- `.github/instructions/testing.instructions.md`
- `.github/instructions/documentation.instructions.md`
- `.github/plans/README.md`
- `.github/reviews/README.md`

## Configuration and infrastructure impact

- Repository administrators must create the permanent `ai-development` label before use. On the
  first authorized run, the controller may idempotently ensure the seven state labels with
  documented colors/descriptions.
- Store a fine-grained PAT or GitHub App user access token as `COPILOT_AGENT_TOKEN` with Agent
  Tasks read/write only. Do not use a classic PAT when a fine-grained user-to-server credential
  is available; document owner, expiry, rotation, revocation, and the public-preview dependency.
- The controller's `GITHUB_TOKEN` needs only `contents: write`, `issues: write`, and
  `pull-requests: write`; the watchdog needs `issues: write`, `pull-requests: read`, and
  `actions: read`. Neither receives merge, administration, secrets, or `id-token` permission.
- Read max iterations from repository variable `AI_DEVELOPMENT_MAX_ITERATIONS`; default to `3`,
  accept only an integer from `0` through a documented safety ceiling of `10`, and fail closed on
  invalid values. Record the effective value in controller state.
- Applying `ai-development` by an actor whose effective repository permission is write or higher
  authorizes the complete non-blocked plan and all bounded stages. Opened issues with a
  pre-populated label still require that authorization check.
- The reusable installer must not silently enable issue automation.
- No language runtime, build tool, package manager, or application dependency is introduced.

## Security, reliability, and performance considerations

- Never place issue title/body/comment text directly in `run:`; send fixed API requests with
  JSON-safe serialization.
- Do not echo tokens, authorization headers, complete API responses, or secret-bearing command
  lines.
- Preserve unrelated labels when changing state and verify the result.
- Fail closed on ambiguous events, invalid verdicts, missing configuration, unsupported branch
  control, or state mismatch.
- Concurrency plus durable identity checks must protect against the `opened` and `labeled`
  events arriving close together.
- Check out only the trusted default-branch controller with persisted credentials disabled.
  Never checkout or execute the AI PR head in either privileged workflow.
- Bound API retries, task polls, per-task wait time, whole-job timeout, and review loops. Polling
  is required because Agent Tasks exposes state but no documented completion webhook.
- Never add merge, auto-approve, branch-protection bypass, or broad organization/repository
  administration permissions.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Agent Tasks API changes during preview | Pin API version/Accept headers, integration-test in a disposable private repository, and fail closed on unknown fields/states |
| Exact head-branch write fails | Create the branch and open PR first, then pass both documented `base_ref` and `head_ref`; verify returned task artifacts/head SHA |
| AI omits or corrupts an artifact | Strictly validate expected path/schema/verdict and fail rather than infer success |
| Label replacement can overwrite unrelated labels | Fetch, preserve, replace, and verify the full label set; stop on mismatch |
| Duplicate events create multiple tasks/PRs | Per-issue concurrency plus branch, PR marker, controller comment, and task-ID checks |
| Iteration count is lost on restart | Persist it in the machine-readable controller comment and re-read before starting a task |
| Documentation changes occur after code review | Constrain them to the approved documentation stage and record their outcome; decide whether repository policy requires a final docs-only review |
| Secret/API response leakage | Minimal secret scope, fixed payload construction, masking, and validation scans |
| Prior plan conflicts with new requirements | Explicitly supersede only label-only triggering and deferred status/comment scope |
| Controller run is cancelled or times out | No-checkout `workflow_run` watchdog converts unfinished state to one actionable `ai-failed` result |
| Native bot review is mistaken for merge approval | Treat the artifact/comment verdict as lifecycle evidence only; retain human/ruleset approval and merge gates |

## Testing plan

### Static/unit-style validation

- Parse all three workflow YAML files with `actionlint`.
- Run `node --test .github/scripts/ai-development-controller.test.mjs`.
- Extend framework validation to assert all required files and exact label constants.
- Assert the new trigger includes only the intended issue event types and both exact guards.
- Assert `workflow_dispatch`/`workflow_call` resume paths re-fetch the issue and reject requests
  when exact `ai-development` is absent.
- Assert concurrency is keyed by issue and does not cancel active work.
- Assert no merge or auto-merge operation exists.
- Assert issue-controlled expressions are not interpolated into shell scripts.
- Parse the PowerShell installer and smoke-test copy behavior with and without
  `-IncludeWorkflows`.

### Disposable repository integration matrix

1. Open issue with `ai-development` already present: one controller identity, `ai-planning`.
2. Open without the label, then add exact label: one controller identity, `ai-planning`.
3. Add unrelated or case-variant label: no Agent Task.
4. Cause both qualifying events or re-add the label: no duplicate Agent Task, branch, PR, or
   terminal comment.
5. Verify every transition leaves `ai-development` plus exactly one active-state label and
   preserves unrelated labels.
6. Verify branch is exactly `ai/issue-<number>-<slug>`, the draft PR predates the Agent Task,
   every task uses its `head_ref`, and the PR links the issue and artifacts.
7. Verify `CHANGES REQUESTED` loops through remediation and stops at the configured cap.
8. Verify only `APPROVED` enters documentation.
9. Verify documentation records exactly `CREATE`, `UPDATE`, or `NO CHANGE`.
10. Verify success sets `ai-complete` and posts one traceable completion comment.
11. Verify blocked/error/cap exhaustion sets `ai-failed` and posts one actionable failure
    comment.
12. Verify no merge occurs and a human remains responsible for merging.
13. Force API error, unknown task state, `waiting_for_user`, timeout, workflow cancellation, and
    missing/ambiguous artifacts; verify one redacted `ai-failed` comment.
14. Verify workflow and agent logs do not disclose secrets or raw authorization data.
15. Verify Copilot-authored PR workflow checks remain distinct from the controller's own
    validation evidence and still respect GitHub's human approval setting.

## Implementation sequence

1. Confirm repository entitlement and provision the minimally scoped user-to-server Agent Tasks
   credential in a disposable private repository.
2. Implement and unit-test shared constants, event guards, slugging, state transitions, label
   reconciliation, durable markers, verdict parsing, documentation classification, and redaction.
3. Implement exact branch/trace commit/draft PR creation and prove Agent Tasks writes to the
   documented `head_ref` with each existing custom-agent filename.
4. Implement the bounded phase loop, durable resume logic, terminal comments, and no-merge
   boundary.
5. Add the watchdog and prove it never checks out or executes PR content.
6. Extend framework validation before broad documentation/installer changes.
7. Update the documentation agent's orchestration-facing classification.
8. Update installer, templates, README, and framework documentation consistently.
9. Run static/unit validation and installer smoke tests.
10. Run the disposable-repository integration matrix, including default workflow-approval
    behavior for Copilot commits.
11. Request evidence-based review of the implementation and remediate findings without
    exceeding the configured cap.

## Validation commands

```bash
actionlint .github/workflows/framework-validation.yml \
  .github/workflows/ai-development.yml \
  .github/workflows/ai-development-watchdog.yml

node --test .github/scripts/ai-development-controller.test.mjs

rg -n "issues:|types:|opened|labeled|ai-development|permissions:|concurrency:" \
  .github/workflows/ai-development.yml

rg -n "ai-(planning|implementation|review|changes-requested|documentation|complete|failed)" \
  .github/agents .github/instructions .github/workflows docs README.md templates

rg -n "APPROVED|CHANGES REQUESTED|CREATE|UPDATE|NO CHANGE|max.*iteration|default.*3" \
  .github/agents .github/instructions docs README.md templates

rg -n "merge|auto-merge|enablePullRequestAutoMerge|mergePullRequest" \
  .github/workflows/ai-development*.yml .github/scripts/ai-development-controller.mjs

rg -n '\$\{\{[[:space:]]*github\.event\.issue\.(title|body)' \
  .github/workflows/ai-development*.yml

rg -n "COPILOT_AGENT_TOKEN|Authorization|console\\.(log|error)" \
  .github/workflows/ai-development*.yml .github/scripts/ai-development-controller.mjs

grep -REn --exclude-dir=.git "REPLACE_WITH_(PROJECT|VALUE)" .

pwsh -NoLogo -NoProfile -Command \
  '$errors = $null; [System.Management.Automation.PSParser]::Tokenize((Get-Content -LiteralPath "./scripts/install-ai-framework.ps1" -Raw), [ref]$errors) | Out-Null; if ($errors) { $errors | Format-List | Out-String | Write-Host; exit 1 }'

pwsh ./scripts/install-ai-framework.ps1 -RepositoryPath <temporary-repository>
pwsh ./scripts/install-ai-framework.ps1 -RepositoryPath <temporary-repository> -IncludeWorkflows
```

## Verification checklist

- [ ] Both exact opt-in paths are covered.
- [ ] `ai-development` remains present through terminal state.
- [ ] Exactly one active-state label remains after every transition.
- [ ] Duplicate events cannot create duplicate work.
- [ ] Exact `head_ref` branch writing and PR traceability are proven in a disposable repository.
- [ ] Review evidence and canonical verdict are persisted.
- [ ] Max review/fix iterations are configurable and default to three.
- [ ] Documentation cannot begin before `APPROVED`.
- [ ] Documentation outcome is one of `CREATE`, `UPDATE`, or `NO CHANGE`.
- [ ] Completion and failure each produce one idempotent issue comment.
- [ ] No auto-merge path exists.
- [ ] Workflow permissions and secrets satisfy least privilege.
- [ ] Installer remains opt-in for workflows.
- [ ] Existing specialist agents and instruction files are reused directly; no coordinator agent
      duplicates them.
- [ ] The watchdog posts one failure result for abnormal controller termination without reading
      or executing untrusted PR content.
- [ ] Artifact verdicts are explicitly distinguished from native required PR approvals.

## Open questions and assumptions

1. **Confirmed design decision:** use Agent Tasks, not Issues assignment. This resolves the prior
   plan's custom-agent identifier question and supports the exact existing PR `head_ref`.
2. **Confirmed policy default:** applying `ai-development` by a writer authorizes planning and
   execution of a non-blocked plan. If maintainers require a separate human plan-approval gate,
   add a distinct approval event in a future plan; do not silently pause this workflow.
3. **Retry semantics:** terminal issues are no-ops on relabel. Recovery is allowed only through
   the maintainer-only dispatch after explicitly removing the terminal state according to the
   operations guide.
4. **Post-documentation review:** default assumption is no second code-review cycle because the
   documentation task is constrained to docs-only paths and its diff is verified. Repositories
   that require docs approval retain normal human PR review/ruleset controls.
5. **Credential choice:** prefer a short-lived GitHub App user access token where an operator can
   provision/refresh it securely; otherwise use an expiring fine-grained PAT. Installation tokens
   are not supported by Agent Tasks.

## Explicit limits

- Repository files establish conventions and the absence of current orchestration, but cannot
  prove repository secrets, organization policy, Copilot entitlement, or live API availability.
- Official docs establish exact existing-PR `head_ref` support, not that every task will finish
  or produce correct changes.
- Label transitions are verified and eventually consistent, not atomic.
- Evidence verdicts control this lifecycle only; they cannot substitute for server-enforced human
  approval or guarantee mergeability.
- Git binary pack/index contents were inventoried as local metadata, not treated as authored
  framework source or decoded into line-addressable evidence.
- Remote label, branch, issue, and pull-request observations can change after this plan.
- No implementation behavior should be claimed until the disposable-repository integration
  matrix passes.

## Handoff instructions

The Implementation Agent must implement the controller rather than a duplicate coordinator
profile. Begin with unit tests and a disposable-repository proof that Agent Tasks accepts each
existing filename and writes to the exact pre-created PR `head_ref`. Keep the Agent Tasks secret
separate from `GITHUB_TOKEN`, preserve unrelated labels, never execute PR-head content in a
privileged context, fail closed on unknown API/task/artifact states, and never approve or merge.
Run every applicable validation command and report commands plus observed results. Any departure
from the state model, exact branch, file list, credential model, or security posture requires a
plan revision before coding.
