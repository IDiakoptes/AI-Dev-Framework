# Agent Workflow Instructions

## Lifecycle
1. User Request
2. Planning Agent creates/updates plan in `.github/plans/`
3. Implementation Agent executes approved plan
4. Code Review Agent evaluates implementation and writes review in `.github/reviews/`
5. If verdict is **CHANGES REQUESTED**, Implementation Agent addresses findings and returns to review
6. If verdict is **APPROVED**, Documentation Agent updates docs
7. Done

## Iteration Control
- Default maximum review/fix iterations: **3**
- After max iterations, require human decision: reduce scope, clarify requirements, or approve exception.

## Traceability
- Every implementation should reference a plan artifact.
- Every review should reference requirements, plan, and changed files.
- Decisions should be evidence-based and repository-specific.

## Repository Context
- If `.github/repository-context.md` exists, agents should read it before making decisions.
- If absent, agents must infer only from observable repository files and user input.
