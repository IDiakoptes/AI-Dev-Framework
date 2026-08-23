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
