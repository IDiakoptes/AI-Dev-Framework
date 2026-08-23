# Workflow

## Standard Lifecycle
User Request → Planning Agent → Plan Artifact → Implementation Agent → Code Changes → Code Review Agent

If **CHANGES REQUESTED**:
Implementation Agent fixes findings → Code Review Agent re-reviews (max default 3 iterations)

If **APPROVED**:
Documentation Agent updates docs → Done

## Human Intervention
If iteration limit is reached or requirements are ambiguous, pause for human direction.

## Automated State Machine (Optional)
When the optional automated issue development orchestration controller is installed and an issue
carries the exact `ai-development` label, the same lifecycle runs as a deterministic label state
machine instead of a manual handoff:

```
(no label) --qualify--> ai-planning --planApproved--> ai-implementation
  --implementationComplete--> ai-review
      --approved--> ai-documentation --documented--> ai-complete
      --changesRequested--> ai-changes-requested --remediationStart--> ai-implementation
  (any active state) --error--> ai-failed
```

- `ai-complete` means the AI lifecycle finished and left an open pull request for human review; it
  never means the change was merged.
- `ai-failed` means a maintainer must inspect the posted failure comment and, if appropriate,
  remove the terminal label before re-dispatching via `workflow_dispatch`.

Full details (labels, secrets, iteration-cap configuration, comments, and troubleshooting) are in
[`automated-issue-workflow.md`](automated-issue-workflow.md).
