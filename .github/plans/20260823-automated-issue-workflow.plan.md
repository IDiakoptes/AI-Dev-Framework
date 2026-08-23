# Optional label-driven AI development workflow

## Task summary

Add an opt-in, technology-agnostic issue workflow whose only initiating event is
the addition of the exact `ai-development` label. The workflow should use the
public-preview, officially documented GitHub Issues API to assign the issue to
Copilot cloud agent with a repository custom orchestrator agent. That
orchestrator should coordinate the existing
Planning, Implementation, Code Review, and Documentation agents, retain the
current planning and review controls, and create date-prefixed plan and review
artifacts.

This plan does not assume that GitHub Actions can execute an `.agent.md` file.
The supported boundary is:

1. GitHub Actions observes an `issues:labeled` event.
2. The workflow calls GitHub's Issues API with a user token and requests Copilot
   assignment with `agent_assignment.custom_agent`.
3. Copilot cloud agent loads the selected custom agent.
4. The orchestrator may invoke the four specialist custom agents through the
   officially documented `agent` tool alias.

## Acceptance criteria

- Only an `issues` event with activity type `labeled` can initiate the workflow.
- The assignment job runs only when the newly added label name equals
  `ai-development`; opening, editing, closing, or unlabeling an issue does not
  initiate it.
- The feature is disabled by default and can be enabled without editing the
  workflow.
- The implementation uses only officially documented GitHub/Copilot mechanisms.
- The implementation does not describe an Actions runner as directly invoking a
  repository custom agent.
- Existing planning behavior remains available and read-only except for its plan
  artifact.
- The intended lifecycle is Planning → Implementation → initial Code Review →
  up to three fix/re-review iterations → Documentation after approval.
- Plans use `.github/plans/YYYYMMDD-<short-task-slug>.plan.md`.
- Reviews use `.github/reviews/YYYYMMDD-<short-task-slug>.review.md`.
- The workflow is technology-agnostic and delegates repository-specific build
  and test discovery to the existing agents and repository context.
- Token permissions, prompt-injection exposure, human review, preview-feature
  limitations, duplicate events, failure handling, and operating cost are
  documented.

## Current state

### Confirmed repository facts

- The repository currently defines four specialist agents: Planning,
  Implementation, Code Review, and Documentation
  (`README.md:8-17`; `docs/architecture.md:11-16`).
- The documented lifecycle is Plan → Implement → initial Review → up to three
  Fix/Review iterations → Document
  (`README.md:46-49`;
  `.github/instructions/agent-workflow.instructions.md:3-14`).
- The Planning Agent already requires repository inspection, separates facts
  from assumptions, avoids application changes, and writes a plan artifact
  (`.github/agents/planning-agent.agent.md:6-46`). Its useful behavior should be
  reused, not folded into a new implementation agent.
- The Implementation Agent requires an approved plan and repository-specific
  validation (`.github/agents/implementation-agent.agent.md:9-37`).
- The Code Review Agent writes a dated review artifact and returns `APPROVED` or
  `CHANGES REQUESTED`
  (`.github/agents/code-review-agent.agent.md:37-44`).
- The Documentation Agent runs after implementation approval
  (`.github/agents/documentation-agent.agent.md:16-26`).
- Existing plan and review naming conventions already match the requested
  `YYYYMMDD-<short-task-slug>` form
  (`README.md:51-57`; `.github/plans/README.md:5-21`;
  `.github/reviews/README.md:5-15`).
- Current documentation says end-to-end orchestration is manual or
  platform-dependent (`README.md:59-62`).
- The only repository-authored workflow is framework validation. It runs on
  pull requests and manual dispatch and grants `contents: read`
  (`.github/workflows/framework-validation.yml:1-12`).
- That workflow currently references `actions/checkout@v4`, not an immutable
  full commit SHA (`.github/workflows/framework-validation.yml:14-15`).
- The installer copies the four agents and supporting documentation. Workflows
  are copied only when `-IncludeWorkflows` is supplied
  (`scripts/install-ai-framework.ps1:83-107`).
- `.github/repository-context.md` is not present. The distributable template is
  `templates/repository-context.md`.
- The observable repository contains documentation, Markdown custom-agent and
  instruction definitions, one PowerShell installer, templates, and the
  validation workflow. It has no package manifest, application runtime,
  conventional unit-test project, or dedicated workflow test harness.
- The tracked baseline is
  `copilot/setup-automated-issue-workflow` at commit `dc83633`, which currently
  matches `main`. This plan is the only untracked worktree artifact after
  planning.
- Authenticated repository API observations on 2026-08-23 confirm that
  `IDiakoptes/AI-Dev-Framework` is private, uses `main` as its default branch,
  is not currently a template repository, has Issues enabled, and has no
  issues. The `ai-development` label is absent; only the ten default labels are
  present.
- The remote has three branches (`main`, the current automation branch, and the
  prior framework-setup branch); the API reports all three as unprotected.
  The only direct collaborator returned is the repository owner with admin
  access.
- Actions exposes one repository-authored workflow
  (`.github/workflows/framework-validation.yml`) plus GitHub-managed dynamic
  workflows for Copilot cloud agent and Copilot pull-request review. The most
  recent framework-validation run completed successfully for commit `c674d38`.
- Secret values, Actions variables, environments, rulesets not reflected by the
  branch endpoint, and Copilot entitlement/custom-agent policy are not exposed
  by the available APIs and remain unconfirmed. Local `gh` authentication is
  unavailable, so the `suggestedActors` Copilot-assignability query could not be
  executed.

### Confirmed official platform facts

1. GitHub Actions supports `on: issues: types: [labeled]`. The documented trigger
   filters activity type, not a particular label name, so the exact label must
   be checked with a job-level expression such as
   `github.event.label.name == 'ai-development'`. Non-target label additions
   will still create skipped workflow runs.
   [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#issues);
   [workflow event syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onevent_nametypes).
2. GitHub officially documents assigning existing issues to Copilot through the
   Issues REST or GraphQL API. Both accept an optional agent-assignment input,
   including `custom_agent`; the REST example uses
   `POST /repos/{owner}/{repo}/issues/{issue_number}/assignees`,
   `copilot-swe-agent[bot]`, and an `agent_assignment` object.
   [Using Copilot cloud agent via the API](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api#using-the-issues-api).
3. The issue-assignment API is in public preview and requires a user token. For
   a fine-grained PAT, GitHub documents Metadata read plus Actions, Contents,
   Issues, and Pull requests read/write. A classic PAT needs `repo`. User-to-
   server GitHub App tokens are supported; installation/server-to-server tokens
   are not. The repository workflow's ordinary `GITHUB_TOKEN` must not be
   represented as satisfying this requirement.
   [API authentication and permissions](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api#authentication);
   [Using `GITHUB_TOKEN`](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token).
4. Repository custom agents live under `.github/agents/`, support
   `target: github-copilot`, and can be selected when assigning Copilot to an
   issue.
   [Creating custom agents](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/create-custom-agents).
5. The official custom-agent tool aliases include `agent`, whose cloud-agent
   purpose is to invoke a different custom agent. The same reference documents
   `disable-model-invocation`, `user-invocable`, and least-privilege tool lists.
   [Custom agents configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration#tools).
6. Assigning an issue to Copilot always creates a pull request. Copilot receives
   the issue title, description, and comments existing at assignment time, but
   not later issue comments.
   [Kick off a task with Copilot agents](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/kick-off-a-task#assign-an-issue-to-copilot).
7. Copilot Automations do not expose a label-added trigger. Their documented
   event triggers are issue created, pull request opened, and pull request
   synchronized; they are also limited to private/internal repositories and are
   stored outside Git. They are not a substitute for this version-controlled,
   label-driven workflow.
   [About Copilot automations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-automations#triggers).
8. Agentic Workflows can use Actions-style triggers, but the official material
   does not establish deterministic selection and execution of these repository
   custom-agent profiles. Do not use Agentic Workflows to claim that capability.
   [Creating GitHub Agentic Workflows](https://docs.github.com/en/copilot/how-tos/github-agentic-workflows/creating-github-agentic-workflows).
9. Copilot-created pull request workflows require approval from a user with
   write access by default. Agent approval is not equivalent to a branch-
   protection approval.
   [Reviewing Copilot output](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/review-copilot-output).
10. GitHub recommends least-privilege tokens, secrets rather than plaintext
    credentials, immutable action references, and intermediate environment
    variables instead of embedding event data directly into shell source.
    [Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use).

## Desired state

```text
Maintainer adds the exact ai-development label
  |
  v
GitHub Actions receives issues:labeled
  |
  +-- enable variable is not true ------------> skipped
  +-- added label differs --------------------> skipped
  +-- issue is already assigned to Copilot ---> no-op
  |
  v
Issues REST API assigns copilot-swe-agent[bot]
with agent_assignment.custom_agent
  |
  v
AI Development Workflow custom agent
  |
  +-- Planning Agent -> dated plan artifact
  +-- stop if requirements/open questions block safe work
  +-- Implementation Agent
  +-- Code Review Agent -> dated review artifact
  +-- fixes/re-review, maximum three fix/re-review iterations
  +-- stop on unresolved findings or failed validation
  +-- Documentation Agent only after APPROVED
  |
  v
One Copilot-created pull request
  |
  v
Human review, workflow approval, and repository merge controls
```

This is the maximum supportable repository-contained automation based on the
documented mechanisms. The Actions workflow delegates through the Issues API;
it does not launch or supervise custom-agent subprocesses. The orchestrated
chain is model-directed rather than a transactional workflow engine, so prompts,
artifact checks, review limits, and human PR review are necessary safeguards.

## Repository findings and architecture impact

### Agent architecture

- Add one coordinator rather than changing the responsibilities of the existing
  four agents.
- The coordinator owns lifecycle state, a single date/slug artifact key, stop
  conditions, and the review-attempt count.
- The coordinator invokes the existing Planning Agent first and verifies that
  the expected plan file exists before proceeding.
- The plan remains the source of truth. The coordinator must not silently fill
  blocking open questions with invented requirements.
- The Implementation Agent remains responsible for technology discovery and
  validation. The coordinator must pass the plan path and issue context, not a
  technology-specific build recipe.
- Each review pass updates the same review artifact so the PR has one canonical
  `YYYYMMDD-<short-task-slug>.review.md` containing the current verdict and
  enough history to audit previous requested changes.
- Documentation is invoked only after the Code Review Agent reports `APPROVED`.

### Event and API architecture

- Use only `issues: { types: [labeled] }`.
- Put both gates on the assignment job:
  `github.event.label.name == 'ai-development'` and
  `vars.AI_DEVELOPMENT_ENABLED == 'true'`.
- Use per-issue concurrency, for example a group derived from repository ID and
  issue number, with `cancel-in-progress: false`.
- Before POSTing, check the issue's current assignees. If
  `copilot-swe-agent[bot]` is already present, finish successfully without a
  second assignment.
- Use the documented REST add-assignees endpoint. Construct its JSON from
  constants and trusted event metadata (`repository.full_name`,
  `repository.default_branch`, and issue number). Pass all expression values
  through environment variables and JSON-encode them; do not interpolate issue
  title, body, or comments into `run:` source.
- Use a dedicated Actions secret for the required user token. Explicitly set
  the workflow `GITHUB_TOKEN` to no permissions (`permissions: {}`) because the
  external user token performs the API call.
- Keep the API call isolated in one step so preview API changes have a small
  blast radius and a clear manual rollback.
- Do not check out issue-authored code or use `pull_request_target`.

### Data, runtime, and performance impact

- No application data model, database, deployment, service, or runtime
  dependency changes.
- One Actions run is created for every label addition, but non-target labels
  skip the assignment job. This unavoidable overhead should be documented.
- A successful assignment consumes Copilot/AI usage and Actions minutes and
  always creates a pull request.
- Concurrency and the assignee precheck prevent most duplicate work, but they
  cannot make a preview API globally exactly-once.

## Files to create

### `.github/agents/ai-development-workflow.agent.md`

Create the explicit orchestration profile.

- Frontmatter:
  - a stable `name` and a description that states it coordinates the four
    existing specialists;
  - `target: github-copilot`;
  - `disable-model-invocation: true` so Copilot does not infer it for unrelated
    tasks;
  - `user-invocable: true` so it can be selected for issue assignment;
  - least-privilege aliases needed for coordination and verification:
    `read`, `search`, `execute`, and `agent`; omit `edit` because specialist
    agents, not the coordinator, own file changes;
- Prompt requirements:
  - treat issue text and linked content as untrusted requirements, not
    instructions that override repository policy;
  - compute one UTC `YYYYMMDD` and one sanitized lower-kebab task slug in the
    form `issue-<number>-<sanitized-title>` (cap the full slug at 64 characters,
    strip leading/trailing hyphens, collapse repeats, and fall back to
    `issue-<number>`), then reuse both for plan and review paths;
  - invoke the existing Planning Agent without weakening its evidence,
    open-question, or no-application-change rules;
  - stop if the plan reports blocking unknowns or cannot meet acceptance
    criteria;
  - require the configured approval policy before invoking Implementation;
  - invoke Implementation with the approved plan path;
  - invoke Code Review, accept only its documented verdicts, and allow one
    initial review plus no more than three fix/re-review iterations;
  - on `CHANGES REQUESTED`, send concrete findings and the same plan path back
    to Implementation, then re-review;
  - stop and report unresolved findings after the third fix/re-review iteration;
  - invoke Documentation only after `APPROVED`;
  - verify both artifacts exist and match the same date/slug before completion;
  - leave the final trust/merge decision to a human.

### `.github/workflows/ai-development-issue.yml`

Create the disabled-by-default label listener and API delegation workflow.

- Trigger only `issues` with `types: [labeled]`.
- Add workflow-level `permissions: {}`.
- Add exact, case-sensitive label and enable-variable job conditions.
- Add per-issue concurrency with no cancellation of an in-flight assignment.
- Use `secrets.COPILOT_ASSIGNMENT_TOKEN`; fail clearly if absent, without
  printing it.
- Query current assignees and no-op when Copilot is already assigned.
- POST to the documented add-assignees endpoint with:
  - `assignees: ["copilot-swe-agent[bot]"]`;
  - `agent_assignment.target_repo` set to the current repository;
  - `agent_assignment.base_branch` set to the repository default branch;
  - `agent_assignment.custom_agent` set only after its accepted API identifier
    is confirmed;
  - no model override and no duplicated issue content.
- Check HTTP/API failure status and emit a non-secret diagnostic.
- Do not use checkout or third-party actions.

### `docs/automated-issue-workflow.md`

Document:

- prerequisites and availability;
- exact label and enable-variable setup;
- token type, minimum documented permissions, storage, rotation, and revocation;
- custom-agent identifier verification;
- lifecycle, artifact naming, review cap, and approval policy;
- skipped runs for other labels;
- assignment-always-creates-PR behavior;
- later issue comments not reaching the agent;
- prompt-injection and untrusted-issue risks;
- default approval of Copilot PR workflows;
- idempotency and public-preview limitations;
- usage/cost considerations;
- troubleshooting for missing token, unavailable Copilot, invalid custom agent,
  API changes, failed specialist stages, and unresolved review findings;
- disable/rollback procedure: set the enable variable false or remove it,
  revoke the token, and manually unassign/close unintended work.

## Files to update

### `.github/workflows/framework-validation.yml`

- Assert the new agent, workflow, and documentation exist.
- Validate required custom-agent frontmatter and that the coordinator references
  all four existing agents and both artifact directories.
- Assert that the new workflow contains only the `issues:labeled` trigger, the
  exact label guard, the opt-in variable, concurrency, no default token
  permissions, the Copilot assignee, and `custom_agent`.
- Add negative checks for `opened`, `edited`, `unlabeled`,
  `pull_request_target`, issue title/body interpolation, and accidental
  plaintext tokens.
- Pin `actions/checkout` to a reviewed full commit SHA and retain a version
  comment for update tooling.

### `.github/instructions/agent-workflow.instructions.md`

- Describe the optional coordinator path alongside the existing manual path.
- Define the shared date/slug key, stage order, plan blocking conditions,
  approval point, canonical review artifact, three-iteration maximum, and
  documentation-after-approval rule.
- State that Actions delegates through the Issues API and does not execute
  custom agents directly.

### `.github/instructions/security.instructions.md`

- Classify issue titles, bodies, comments, links, and attachments as untrusted.
- Require repository instructions and the approved plan to outrank issue-borne
  instructions.
- Prohibit direct event-data interpolation into shell source.
- Require least-privilege user tokens, secret storage, rotation, log review,
  and human review of generated PRs.

### `scripts/install-ai-framework.ps1`

- Add the coordinator agent and automation documentation to normal framework
  installation.
- Copy `ai-development-issue.yml` only when `-IncludeWorkflows` is supplied,
  preserving the installer's current opt-in workflow behavior.
- Ensure the existing skip-by-default and `-Force` overwrite behavior applies
  to the new files. Do not document or test a dry-run mode; the current
  installer does not provide one.
- Do not create labels, secrets, variables, or Copilot settings from the
  installer; document those as administrative post-install steps.

### `README.md`

- Add the coordinator as an optional fifth profile without changing the four
  specialist responsibilities.
- Replace the blanket statement that orchestration is manual/platform-dependent
  with the precise supported architecture and limitations.
- Link the automation setup guide and state that installation/enablement is
  opt-in.

### `docs/agents.md`

- Add the coordinator's scope, tool boundary, stop conditions, and relationship
  to the four existing agents.

### `docs/architecture.md`

- Add the label event → Actions → Issues API → Copilot coordinator → specialist
  agents → PR sequence.
- Mark the API/custom-agent chain as public-preview/model-directed rather than
  transactional.

### `docs/configuration.md`

- Add label, Actions variable, Actions secret, Copilot policy, custom-agent
  identifier, token, and approval-policy configuration.

### `docs/installation.md`

- Explain `-IncludeWorkflows`, post-install repository administration, disabled-
  by-default behavior, and a disposable-issue smoke test.

### `docs/workflow.md`

- Describe automatic and manual lifecycle variants, artifact key reuse, stop
  conditions, review-loop cap, human workflow approval, and merge boundary.

### `docs/customization.md`

- Explain safe customization of the coordinator, label, slug policy, and
  specialist prompts without claiming unsupported trigger or agent APIs.

### `templates/repository-context.md`

- Add optional fields for whether label-driven AI development is allowed, who
  may apply the label, whether label application authorizes implementation, the
  plan approval policy, review policy, validation requirements, and artifact
  slug preferences.

### `templates/copilot-instructions.md`

- Add guidance for untrusted issue content, repository-policy precedence,
  automated stage boundaries, artifact paths, and human merge authority.

## Files intentionally preserved

- Keep the four existing specialist agent profiles unchanged unless manual
  integration proves a concrete incompatibility. In particular, do not replace
  `.github/agents/planning-agent.agent.md` with the coordinator.
- Keep `.github/plans/README.md` and `.github/reviews/README.md` unchanged unless
  the final slug policy needs clarification; their naming convention already
  satisfies the requirement.
- Do not create `.github/repository-context.md` in this framework repository;
  update its distributable template instead.
- Do not add application-language dependencies or a repository-specific build
  system.

## Configuration and infrastructure impact

Before enablement, a repository administrator must:

1. Confirm the repository's default branch and visibility.
2. Confirm the token owner's Copilot plan and that Copilot cloud agent and
   custom agents are enabled for the repository/organization.
3. Create the exact `ai-development` label.
4. Merge the coordinator profile and workflow to the default branch.
5. Verify the platform-recognized value expected by the API's `custom_agent`
   field and configure that exact value in the workflow.
6. Prefer a dedicated fine-grained PAT with the documented assignment
   permissions. A GitHub App user-to-server token is also supported by the API,
   but it is short-lived and must be minted through a valid user authorization
   flow; do not store one as a long-lived static secret or substitute an
   unsupported installation token.
7. Store it as `COPILOT_ASSIGNMENT_TOKEN` in Actions secrets. Prefer an
   environment secret with required reviewers if an approval-before-assignment
   policy is desired.
8. Create `AI_DEVELOPMENT_ENABLED=true` only after static and disposable
   integration validation.
9. Retain branch protection, required human reviews, CODEOWNERS protection for
   `.github/workflows/` and `.github/agents/` where available, and the default
   requirement to approve workflows from Copilot-created PRs.

No cloud resource, service, database, or deployment migration is required.

## Testing plan

### Static repository validation

- Parse/validate both workflow YAML files with `actionlint` during
  implementation verification; do not add it as a permanent dependency unless
  the repository explicitly chooses to.
- Run the existing framework validation and extend it with the new positive and
  negative assertions listed above.
- Validate all custom-agent frontmatter and required coordinator properties.
- Confirm the installer PowerShell parses successfully. In temporary target
  repositories, verify the coordinator/docs are copied normally while the
  workflow is copied only with `-IncludeWorkflows`.
- Run installer smoke tests into temporary empty destinations with and without
  `-IncludeWorkflows`; compare resulting file lists and confirm existing files
  are not overwritten unless requested.
- Search the workflow for secret literals, issue title/body/comment shell
  interpolation, unpinned action references, `pull_request_target`, and
  unnecessary token permissions.

### Manual integration matrix

Use a disposable issue, preferably in a disposable private test repository with
the same configuration:

1. Enable variable absent/false + target label added: assignment job is skipped.
2. Enabled + unrelated label added: workflow run exists but assignment job is
   skipped.
3. Enabled + issue opened with the label already present: no assignment, because
   only label addition is a trigger.
4. Enabled + target label added: one API assignment succeeds and one Copilot PR
   is created.
5. Target label is removed: no workflow is initiated.
6. Target label is re-added while Copilot remains assigned: successful no-op.
7. Two target-label events are delivered close together: concurrency serializes
   them and the assignee precheck prevents a second task.
8. Token missing/expired/underprivileged: job fails clearly and no secret appears
   in logs.
9. Copilot disabled or custom-agent identifier invalid: API failure is explicit
   and no fallback agent is silently used.
10. Successful small task: Planning runs first; plan and review share a UTC date
    and slug; Implementation validates repository-specific behavior;
    Documentation runs only after `APPROVED`.
11. Deliberate review defect: `CHANGES REQUESTED` returns to Implementation and
    the chain stops after no more than three fix/re-review iterations following
    the initial review.
12. Blocking planning ambiguity: the coordinator stops without implementation.
13. Comment added to the issue after assignment: verify it is not treated as new
    task context and document PR follow-up instead.
14. Copilot PR checks: verify a write-authorized human must approve workflows,
    then inspect logs and complete normal human review.

### Documentation validation

- Follow the setup guide from a clean installation destination.
- Verify every setting name, secret name, label, file path, and API limitation
  matches the implemented files.
- Verify the manual four-agent workflow remains documented and usable when the
  automation is disabled.

## Security considerations

- Applying `ai-development` is an authorization decision. Restrict label
  application operationally to trusted maintainers; GitHub issue content may
  originate from untrusted users.
- A malicious issue can attempt prompt injection. The coordinator must treat
  issue content only as task requirements, honor repository policy first, use
  minimal tools, stop on suspicious/conflicting instructions, and rely on human
  PR review.
- Use a dedicated, expiring, fine-grained user token where possible. Store it
  only as an Actions secret, rotate it, audit its owner, and revoke it when the
  feature is disabled.
- The documented fine-grained permissions are broader than issue assignment
  alone. Record this residual risk and do not grant extra repository or
  organization access.
- Never echo the token or enable verbose HTTP tracing. Test failure paths and
  inspect logs for accidental disclosure.
- Do not copy issue title/body/comments into shell source or the assignment
  payload. Copilot already receives assignment-time issue context.
- Avoid third-party actions. Pin any required first-party action to an immutable
  reviewed SHA.
- Do not auto-approve or auto-merge generated work. Preserve branch protection,
  workflow approval, required reviews, and human merge authority.
- Protect changes to the workflow, agent profiles, and repository instructions
  because they control privileged behavior.

## Reliability and performance risks

| Risk | Mitigation |
| --- | --- |
| Every label addition creates a run | Keep only a cheap job condition and document this Actions limitation. |
| Duplicate/replayed label events | Per-issue concurrency, current-assignee precheck, and safe no-op behavior. |
| Public-preview API changes | Isolate the call, pin the API version header, fail closed, document manual assignment/rollback. |
| Wrong `custom_agent` identifier silently selects another behavior | Verify experimentally, assert returned/task metadata where available, and fail rather than omit the field. |
| Model-directed orchestration skips a stage | Coordinator checks expected artifacts/verdicts and stops if a stage result is missing. |
| Review loop does not converge | Hard maximum of three fix/re-review iterations after the initial review, then human handoff with unresolved findings. |
| Later issue context is missed | Direct follow-up to the generated PR, as documented by GitHub. |
| Copilot PR checks remain pending | Document the required write-user approval step. |
| Token owner loses access or entitlement | Clear API diagnostics, ownership/rotation runbook, periodic smoke test. |
| Slug collision or inconsistent artifact names | Compute one key once, sanitize/cap it, and pass the same paths to all agents. |
| Untrusted issue attempts prompt or script injection | Trusted label gate, environment variables/JSON encoding, no issue-text shell interpolation, least tools, human review. |

## Implementation sequence

1. Resolve the plan-approval, re-label, failure-reporting, and slug-policy open
   questions below.
2. Using authenticated repository administration, confirm visibility, default
   branch, label state, Actions policy, Copilot policy/entitlement, token owner,
   branch protection, and custom-agent availability.
3. Create the coordinator profile. Reuse the four specialist agents and add
   explicit stage inputs, artifact checks, stop conditions, and review counter.
4. Manually select the coordinator for a harmless Copilot task to verify that
   the `agent` tool can invoke each repository specialist and that artifacts are
   visible on the same branch.
5. Experiment in a disposable repository/issue to establish the exact accepted
   `custom_agent` API value. Record the confirmed value and evidence in the
   automation guide.
6. Add the label workflow with the enable gate false by default, exact label
   condition, empty built-in token permissions, per-issue concurrency,
   assignee precheck, safe JSON construction, and isolated REST call.
7. Extend framework validation and pin `actions/checkout` to a reviewed full
   SHA.
8. Update the installer, repository-context template, and Copilot instruction
   template while preserving workflow installation opt-in.
9. Update README and focused docs so manual and automatic paths, permissions,
   limitations, cost, troubleshooting, and rollback agree.
10. Run static workflow, agent, installer, secret, and documentation validation.
11. Merge to the default branch with `AI_DEVELOPMENT_ENABLED` absent/false.
12. Configure the label and user-token secret, then run the manual integration
   matrix in a disposable issue.
13. Review the generated artifacts, PR, agent logs, Actions logs, token use, and
   branch-protection behavior.
14. Only after success, set `AI_DEVELOPMENT_ENABLED=true`. Monitor the first real
   runs and retain a documented disable/revoke path.

## Verification checklist

- [ ] Repository settings and Copilot availability are confirmed, not assumed.
- [ ] `ai-development` exists with exact case and trusted-maintainer usage is documented.
- [ ] The workflow is present on the default branch and has only `issues:labeled`.
- [ ] The assignment job requires both the exact label and the enable variable.
- [ ] The built-in `GITHUB_TOKEN` has no permissions in the assignment workflow.
- [ ] The API credential is a supported user token stored as a secret.
- [ ] The accepted custom-agent identifier has been verified against the preview API.
- [ ] Non-target labels, issue creation/editing, and label removal cannot assign Copilot.
- [ ] Duplicate/re-added labels are handled according to the chosen policy.
- [ ] Issue-authored text is never interpolated into shell source.
- [ ] The coordinator can invoke all four existing agents in the intended order.
- [ ] Planning retains evidence, assumption, and no-application-change behavior.
- [ ] Blocking plan questions prevent implementation.
- [ ] The initial review is followed by at most three fix/re-review iterations,
      and unresolved findings then fail closed.
- [ ] Documentation runs only after an `APPROVED` review artifact.
- [ ] Plan and review artifacts share `YYYYMMDD-<short-task-slug>`.
- [ ] Existing manual agent workflow remains usable with automation disabled.
- [ ] Workflow YAML, agent frontmatter, installer, and framework validation pass.
- [ ] Missing/invalid-token and unavailable-Copilot failures reveal no secrets.
- [ ] A successful assignment creates exactly one PR in the smoke test.
- [ ] Copilot PR workflows and merge still require the configured human controls.
- [ ] Setup, limitations, cost, troubleshooting, and rollback docs match behavior.

## Assumptions and open questions

These are not confirmed repository facts and must not be silently decided during
implementation:

1. **Plan approval:** Does adding `ai-development` authorize execution of the
   not-yet-generated plan, or must a human approve the completed plan before
   implementation? The current Implementation Agent requires an approved plan.
   A mandatory approval after planning cannot be a fully uninterrupted,
   label-only single-session chain. Recommended safe default: the label starts
   planning and assignment, while the coordinator stops before implementation
   unless repository policy explicitly defines label application as advance
   authorization for a complete, non-blocked plan.
2. **Custom-agent identifier:** The official API exposes `custom_agent` but the
   cited guide's examples leave its value empty and do not define whether it is
   the filename, display name, or another identifier. This must be verified
   before hard-coding the workflow.
3. **Re-label assumption:** Re-adding the label is a no-op while Copilot remains
   assigned. If a maintainer explicitly unassigns Copilot and later re-adds the
   label, treat it as authorization for a fresh task. If permanent one-task-per-
   issue semantics are required, add a separate durable marker before rollout.
4. **Slug assumption:** Use the deterministic
   `issue-<number>-<sanitized-title>` policy defined above. The issue number is
   mandatory to avoid same-day title collisions.
5. **Failure-reporting assumption:** Fail the Actions job with a non-secret
   diagnostic and use Actions/session logs as the source of truth. Do not add
   issue comments or status labels in the first version; those require extra
   write operations and loop-prevention rules.
6. **Review authority:** The Code Review Agent's `APPROVED` verdict controls the
   Documentation stage only. It is not a GitHub review approval and must not
   satisfy branch protection.
7. **Repository administration:** Visibility, default branch, current labels,
   and branch protection flags were observed as described above. Copilot
   entitlement/policy, effective Actions policy, secrets, variables,
   environments, and rulesets remain unobservable and require an authenticated
   administrator to confirm.
8. **Preview tolerance:** Confirm that repository owners accept reliance on the
   public-preview Issues assignment API and custom-agent behavior.

## Handoff instructions for the Implementation Agent

- Treat this plan and the cited GitHub documentation as the source of truth.
- Resolve every blocking open question with the repository owner before editing
  workflow or agent behavior.
- Start by re-reading all existing agent profiles and instruction files; preserve
  the Planning Agent and the manual four-agent lifecycle.
- Verify the preview API's custom-agent identifier in a disposable context.
  Never omit `custom_agent` as a fallback, because that would silently select
  unspecified behavior.
- Keep the assignment workflow disabled until it is merged to the default
  branch and the complete integration matrix passes.
- Make no technology-specific assumptions and add no application dependency.
- Use least privilege, immutable action SHAs, safe event-data handling, and no
  checkout in the privileged label workflow.
- If official API behavior differs from this plan, stop, update the evidence and
  plan, and request approval rather than inventing an API.
- Finish with static validation, installer smoke tests, a disposable end-to-end
  issue, secret-log review, and normal human review of the generated PR.
