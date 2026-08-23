# Security Instructions

## Core Rules
- Never commit credentials, tokens, keys, connection strings, or secrets.
- Use least privilege for automation and workflow permissions.
- Avoid introducing insecure defaults.
- Validate input and output boundaries appropriate to this repository.
- Do not expose sensitive values in logs or error messages.

## Review Focus
- Authentication/authorization changes
- Dependency risk and provenance
- Data protection, secret handling, and configuration safety
- Injection, deserialization, and SSRF-like risks where relevant

## Agent Behavior
- Prefer verified evidence from repository files over assumptions.
- If a security requirement is unclear, raise a question rather than invent a rule.

## Automated Issue Development Orchestration (Optional)
- Never place issue title/body/comment text directly in a workflow `run:` shell block; send it
  only as a JSON-serialized field in an API request body.
- Never log or comment a raw `Authorization` header, bearer token, or full API response body;
  redact before writing to logs, issue comments, or persisted controller state.
- The controller's `GITHUB_TOKEN` is limited to `contents: write`, `issues: write`, and
  `pull-requests: write`; every other permission scope is `none`. The watchdog is limited to
  `actions: read`, `contents: read`, `issues: write`, and `pull-requests: read`. Neither receives
  `id-token`, administration, or merge-capable permissions.
- The Copilot Agent Tasks credential (`COPILOT_AGENT_TOKEN`) is a separate, minimally scoped
  user-to-server secret; it must never be reused as, or substituted for, `GITHUB_TOKEN`.
- Label and comment writes must preserve unrelated labels, verify the resulting label set, and
  fail closed (set `ai-failed` with a redacted, actionable comment) rather than guess at intent
  when an API call, task state, or artifact is missing, unexpected, or unknown.
- Neither the controller nor the watchdog may check out, read, or execute content from the AI
  pull request's head branch; only the repository's own trusted default branch is checked out.
- No workflow in this repository merges, auto-merges, or approves a pull request; a human remains
  responsible for that decision.
