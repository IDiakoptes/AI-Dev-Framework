# AI Development Framework

Reusable multi-agent framework for GitHub Copilot and Copilot coding agents.

## Overview
This repository provides reusable planning, implementation, review, and documentation workflow assets that can be used across repositories with different technology stacks.

## Features
- Planning Agent
- Implementation Agent
- Code Review Agent
- Documentation Agent
- Repository context template
- Reusable instruction set
- Plan/review artifact conventions
- Optional framework validation workflow
- Optional automated issue development orchestration (Actions controller + watchdog)
- Safe installation script for existing repositories

## Repository Structure
- `.github/agents/` reusable agents
- `.github/instructions/` reusable workflow/security/testing/documentation rules
- `.github/plans/` implementation plan artifacts
- `.github/reviews/` review artifacts
- `.github/scripts/` controller script and unit tests for automated issue orchestration
- `.github/workflows/` optional validation, controller, and watchdog workflows
- `templates/` repository customization templates
- `scripts/install-ai-framework.ps1` installer
- `docs/` framework documentation

## Installation
### 1) New repository from template
Mark this repository as a GitHub template, then create a new repository from it.

### 2) Existing repository installation
```powershell
./scripts/install-ai-framework.ps1 -RepositoryPath "C:\Git\MyProject"
```
Optional:
- `-IncludeWorkflows`
- `-Force`

## Customization
In the consuming repository:
1. Create `.github/repository-context.md` from `templates/repository-context.md`.
2. Customize repository Copilot instructions from `templates/copilot-instructions.md`.
3. Add technology-specific instruction files as needed.

## Agent Workflow
Plan → Implement → Review → (Fix → Review)* → Document

Default max fix/review iterations: 3, then require human intervention.

## Automated Issue Development Orchestration (Optional)
An opt-in GitHub Actions controller can run this same lifecycle for one GitHub issue at a time.
It starts only when the exact `ai-development` label is present on issue creation or is later
added, calls the existing four agents directly through the Copilot Agent Tasks API against one
`ai/issue-<number>-<slug>` branch and draft pull request, and never merges, auto-merges, or
approves that pull request — a human remains responsible for that decision. See
[`docs/automated-issue-workflow.md`](docs/automated-issue-workflow.md) for prerequisites,
required label/secret setup, the state model, and troubleshooting.

## Plans and Reviews
- Plans: `.github/plans/`
- Reviews: `.github/reviews/`

Use predictable names:
- `YYYYMMDD-<short-task-slug>.plan.md`
- `YYYYMMDD-<short-task-slug>.review.md`

## Automation Support
- **Fully supported**: Manual agent-driven workflow with plan/review artifacts.
- **Partially supported**: Generic framework validation workflow; optional automated issue
  development orchestration (public-preview Agent Tasks API, opt-in per issue).
- **Manual**: Merging the pull request produced by any workflow; no workflow in this repository
  merges or approves on an agent's behalf.

## Security
- No credentials or secrets should be stored in framework files.
- Use least-privilege workflow permissions.
- Do not encode production access or environment secrets.

## Versioning
Semantic versioning (`MAJOR.MINOR.PATCH`):
- MAJOR: breaking changes
- MINOR: backward-compatible features
- PATCH: backward-compatible fixes

Use Git tags/releases and publish upgrade notes.

## Contributing
Contributions should preserve framework/repository-knowledge separation, remain technology-agnostic in core files, and include validation evidence.

## License
No license file is currently included. Choose a license intentionally based on intended reuse and governance model before broad distribution.
