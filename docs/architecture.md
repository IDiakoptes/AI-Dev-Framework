# Framework Architecture

This repository provides reusable AI-development workflow assets for GitHub Copilot-based multi-agent delivery.

## Separation of Concerns
- **Framework knowledge**: planning, implementation, review, documentation workflow and quality controls.
- **Repository knowledge**: stack, architecture, business rules, infrastructure, and constraints.

Repository knowledge is supplied by the consuming repository through its own files (including optional `.github/repository-context.md`).

## Core Components
- Agents: planning, implementation, code review, documentation
- Instructions: workflow, security, testing, documentation
- Templates: repository context, Copilot repository guidance
- Artifacts: `.github/plans/` and `.github/reviews/`
- Optional validation workflow and installation script
- Optional automated issue development orchestration layer (event/controller/state), documented
  in [`../docs/automated-issue-workflow.md`](automated-issue-workflow.md)

## Optional Automated Orchestration Layer
When installed and enabled per issue (exact `ai-development` label), a GitHub Actions controller
adds one deterministic layer on top of the same four agents:

- **Event layer**: `issues: [opened, labeled]`, plus maintainer `workflow_dispatch`/reusable
  `workflow_call` resume paths that always re-fetch the issue and its labels.
- **Controller layer**: `.github/scripts/ai-development-controller.mjs` qualifies the event,
  reconciles labels, creates the canonical `ai/issue-<number>-<slug>` branch and draft pull
  request, and calls the Copilot Agent Tasks API for each existing specialist agent filename.
- **State layer**: the permanent `ai-development` marker plus exactly one of seven active-state
  labels, persisted alongside a durable, idempotent controller-state pull request comment.
- **Recovery layer**: a no-checkout `workflow_run` watchdog that converts an abnormally terminated
  controller run into one actionable `ai-failed` result.

This layer is additive and optional: it never replaces the four agents, never introduces a fifth
coordinator agent, and never merges or approves the pull requests it opens.
