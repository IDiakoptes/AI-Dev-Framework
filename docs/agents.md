# Agents

## Planning Agent
Read-only analysis agent that produces implementation-ready plans in `.github/plans/`.

## Implementation Agent
Executes approved plans with minimal scope and validation.

## Code Review Agent
Performs evidence-based review, severity classification, and verdict (`APPROVED` or `CHANGES REQUESTED`) in `.github/reviews/`.

## Documentation Agent
Runs after approval and ensures documentation reflects final implementation behavior.

## Automated Orchestration Controller (Not a Fifth Agent)
The optional `.github/workflows/ai-development.yml` controller is a deterministic GitHub Actions
script (`.github/scripts/ai-development-controller.mjs`), not an additional agent profile. It
directly selects and calls the four existing agents above by their `.github/agents/*.agent.md`
filenames through the Copilot Agent Tasks API — it does not add a coordinator/orchestrator agent
and does not change what each of the four agents is responsible for. See
[`../docs/automated-issue-workflow.md`](automated-issue-workflow.md) for how it drives them.
