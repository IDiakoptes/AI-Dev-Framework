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
