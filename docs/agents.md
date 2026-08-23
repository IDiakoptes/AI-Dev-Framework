# Agents

## Planning Agent
Read-only analysis agent that produces implementation-ready plans in `.github/plans/`.

## Implementation Agent
Executes approved plans with minimal scope and validation.

## Code Review Agent
Performs evidence-based review, severity classification, and verdict (`APPROVED` or `CHANGES REQUESTED`) in `.github/reviews/`.

## Documentation Agent
Runs after approval and ensures documentation reflects final implementation behavior.
