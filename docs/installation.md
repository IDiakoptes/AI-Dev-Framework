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
- `-IncludeWorkflows` to copy reusable workflow files
- `-Force` to overwrite existing files intentionally

The installer does not delete files and skips existing files by default.
