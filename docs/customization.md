# Customization

## What to Customize in Consuming Repositories
- `.github/repository-context.md`
- Repository Copilot instructions
- Technology-specific instruction files
- Validation/test commands
- Approval gates and iteration limits
- `AI_DEVELOPMENT_MAX_ITERATIONS` if the optional automated orchestration controller is installed

## Automated Orchestration Customization Boundaries
If `.github/workflows/ai-development.yml` and its watchdog are installed:
- Safe to customize: `AI_DEVELOPMENT_MAX_ITERATIONS` (0–10), the `COPILOT_AGENT_TOKEN` secret's
  owner/rotation policy, and repository branch-protection rules applied to the resulting pull
  requests.
- Not safe to customize without a plan update: the exact `ai-development` label name, the label
  set/state machine, the `ai/issue-<number>-<slug>` branch convention, workflow permissions, or
  adding a merge/auto-merge step. These are load-bearing for duplicate protection, least
  privilege, and the "a human merges" boundary described in
  [`automated-issue-workflow.md`](automated-issue-workflow.md).
- **Retry policy**: a terminal `ai-failed`/`ai-complete` label is a no-op on further label events
  by design. Recovery requires a maintainer to remove the terminal label and re-dispatch the
  controller via `workflow_dispatch`; there is no silent automatic retry.

## Backward Compatibility Guidance
Use semantic versioning for this framework:
- **MAJOR**: breaking prompt/instruction/template/install behavior changes
- **MINOR**: backward-compatible features
- **PATCH**: bug fixes and clarifications

When updating consuming repositories, review release notes for breaking changes before replacing files.
