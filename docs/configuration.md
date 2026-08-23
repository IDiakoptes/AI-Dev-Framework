# Configuration

## Repository Context
Copy `templates/repository-context.md` to `.github/repository-context.md` in the consuming repository and fill only applicable sections.

## Copilot Instructions
Use `templates/copilot-instructions.md` as a starting point for repository-specific standards.

## Extensibility
Add technology-specific instructions as needed, for example:
- `.github/instructions/dotnet.instructions.md`
- `.github/instructions/react.instructions.md`
- `.github/instructions/python.instructions.md`
- `.github/instructions/azure.instructions.md`
- `.github/instructions/database.instructions.md`

## Placeholder Convention
If you use the optional `framework-validation.yml`, keep placeholder text in the `REPLACE_WITH_<VALUE>` style so automated checks can detect unresolved template values.

## Automated Issue Development Orchestration (Optional)
- **Label constants**: permanent marker `ai-development`; exactly one active-state label at a
  time from `ai-planning`, `ai-implementation`, `ai-review`, `ai-changes-requested`,
  `ai-documentation`, `ai-complete`, `ai-failed`.
- **Max iterations**: repository variable `AI_DEVELOPMENT_MAX_ITERATIONS`. Accepts an integer from
  `0` through `10`; defaults to `3` when unset; any other value fails the controller run closed.
- **Token configuration**: repository secret `COPILOT_AGENT_TOKEN` — a fine-grained personal
  access token or GitHub App user access token scoped to Agent Tasks read/write only. Separate
  from the controller's own `GITHUB_TOKEN`; never reused between the two.

See [`automated-issue-workflow.md`](automated-issue-workflow.md) for full setup and precedence
details.
