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
- Safe installation script for existing repositories

## Repository Structure
- `.github/agents/` reusable agents
- `.github/instructions/` reusable workflow/security/testing/documentation rules
- `.github/plans/` implementation plan artifacts
- `.github/reviews/` review artifacts
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

## Plans and Reviews
- Plans: `.github/plans/`
- Reviews: `.github/reviews/`

Use predictable names:
- `YYYYMMDD-<short-task-slug>.plan.md`
- `YYYYMMDD-<short-task-slug>.review.md`

## Automation Support
- **Fully supported**: Manual agent-driven workflow with plan/review artifacts.
- **Partially supported**: Generic framework validation workflow.
- **Manual**: End-to-end autonomous agent orchestration (platform-dependent).

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
