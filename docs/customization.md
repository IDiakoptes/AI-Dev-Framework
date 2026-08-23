# Customization

## What to Customize in Consuming Repositories
- `.github/repository-context.md`
- Repository Copilot instructions
- Technology-specific instruction files
- Validation/test commands
- Approval gates and iteration limits

## Backward Compatibility Guidance
Use semantic versioning for this framework:
- **MAJOR**: breaking prompt/instruction/template/install behavior changes
- **MINOR**: backward-compatible features
- **PATCH**: bug fixes and clarifications

When updating consuming repositories, review release notes for breaking changes before replacing files.
