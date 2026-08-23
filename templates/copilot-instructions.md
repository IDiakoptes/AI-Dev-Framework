# Copilot Instructions Template (Repository-Wide)

Use this as a starting point and customize for your repository.

## General Engineering Standards
- Inspect relevant code, tests, configs, and docs before changing files.
- Reuse existing repository patterns and architecture.
- Keep scope focused; avoid unrelated refactors.
- Verify behavior with tests or documented manual validation.
- Prefer evidence from repository files over assumptions.

## Security
- Never commit secrets or credentials.
- Use least-privilege configuration for automation.
- Avoid logging sensitive information.
- Validate untrusted inputs according to repository threat model.

## Testing and Validation
- Add/update tests when behavior changes and test infrastructure exists.
- Run targeted tests first.
- Report validation commands and outcomes.
- Do not claim completion without validation evidence.

## Reliability and Operations
- Preserve or improve error handling and observability.
- Keep dependency changes minimal and justified.
- Consider backward compatibility and migration impact.

## Git Hygiene
- Keep commits focused and traceable.
- Avoid committing generated artifacts unless required.
- Update docs when behavior/configuration changes.

## Documentation
- Ensure documentation reflects actual implementation.
- Mark examples clearly and avoid repository-irrelevant assumptions.

## Repository Context
- Read `.github/repository-context.md` when available.
- If repository context is missing, infer only from observable files and explicit user input.

## Automated Issue Development Orchestration (If Installed)
- If `.github/workflows/ai-development.yml` is installed, the exact `ai-development` issue label
  starts an automated Plan → Implement → Review → (Fix → Review)\* → Document run for that issue.
- Treat its `ai-complete` label as "the automated lifecycle finished, pull request awaiting human
  review" — not as merged or approved. No workflow in this repository merges, auto-merges, or
  approves on an agent's behalf; do not add one without a plan update.
- See `docs/automated-issue-workflow.md` in the framework repository for the full state model.
