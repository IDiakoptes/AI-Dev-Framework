# Installation

## Option A: Use as a GitHub Template Repository
1. In GitHub, mark this repository as a template.
2. Create a new repository from the template.
3. Customize templates and instructions for the new repository.

## Option B: Install into an Existing Local Repository
Run from this framework repository:

```powershell
./scripts/install-ai-framework.ps1 -RepositoryPath "C:\Git\MyProject"
```

Optional switches:
- `-IncludeWorkflows` to copy reusable workflow files (validation, and the automated issue
  orchestration controller/watchdog and their controller/test scripts)
- `-Force` to overwrite existing files intentionally

The installer does not delete files and skips existing files by default.

## Optional: Enabling Automated Issue Development Orchestration
After installing with `-IncludeWorkflows`:

1. Confirm Copilot Business/Enterprise entitlement for the repository (required by the
   public-preview Agent Tasks API).
2. Create the permanent `ai-development` label (the controller can also idempotently ensure it and
   the seven state labels on its first authorized run).
3. Create a fine-grained personal access token or GitHub App user access token scoped to Agent
   Tasks read/write only, and store it as the repository secret `COPILOT_AGENT_TOKEN`.
4. Optionally set the repository variable `AI_DEVELOPMENT_MAX_ITERATIONS` (integer `0`–`10`;
   defaults to `3`).
5. Add the exact `ai-development` label to an issue to start the lifecycle.

This feature stays fully disabled until all of the above are done; installing the workflow files
alone does not start any automation. See
[`automated-issue-workflow.md`](automated-issue-workflow.md) for the full state model,
permissions, and troubleshooting.
