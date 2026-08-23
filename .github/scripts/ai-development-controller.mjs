#!/usr/bin/env node
/**
 * AI development orchestration controller.
 *
 * Implements the plan at
 * `.github/plans/20260823-ai-issue-development-orchestration.plan.md`.
 *
 * This module has no package dependency: it uses only Node.js built-ins
 * (global `fetch`, `node:*` modules). It exports pure, unit-testable helpers
 * for trigger qualification, authorization handling, slugging, state
 * transitions, label reconciliation, durable markers, iteration limits,
 * review-verdict parsing, documentation-diff classification, terminal
 * comment construction, and redaction. It also exports a thin network layer
 * and an orchestration entry point (`main`) that composes those helpers.
 *
 * IMPORTANT LIMITATION: the Copilot Agent Tasks REST API is public preview
 * and requires a fine-grained user-to-server credential
 * (`COPILOT_AGENT_TOKEN`). This module cannot be integration-tested against
 * live GitHub/Agent Tasks endpoints in this environment because no such
 * credential, entitled repository, or disposable integration repository is
 * available here. Only the pure helpers and mocked-boundary orchestration
 * paths are covered by
 * `.github/scripts/ai-development-controller.test.mjs`. The controller fails
 * closed (sets `ai-failed` and posts a redacted, actionable comment) whenever
 * an API call, task state, or artifact is missing, unexpected, or unknown,
 * rather than assuming success.
 */

'use strict';

import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Permanent opt-in marker label. Never removed once present. */
export const PERMANENT_LABEL = 'ai-development';

/** Mutually exclusive active-state labels, in lifecycle order. */
export const ACTIVE_LABELS = Object.freeze([
  'ai-planning',
  'ai-implementation',
  'ai-review',
  'ai-changes-requested',
  'ai-documentation',
  'ai-complete',
  'ai-failed',
]);

/** Active-state labels that mean the lifecycle has ended. */
export const TERMINAL_LABELS = Object.freeze(['ai-complete', 'ai-failed']);

/** Collaborator permission values that authorize orchestration. */
export const AUTHORIZED_PERMISSIONS = Object.freeze(['write', 'maintain', 'admin']);

export const DEFAULT_MAX_ITERATIONS = 3;
export const MAX_ITERATIONS_CEILING = 10;
export const MAX_ITERATIONS_VARIABLE = 'AI_DEVELOPMENT_MAX_ITERATIONS';

export const STATE_SCHEMA_VERSION = 1;
export const STATE_COMMENT_MARKER = '<!-- ai-development-controller:state:v1 -->';
const STATE_DATA_PATTERN = /<!-- ai-development-controller:data:(.*?) -->/s;

export const TERMINAL_COMMENT_MARKER_PREFIX = '<!-- ai-development-controller:terminal:';

/** Copilot Agent Tasks custom-agent filenames, in call order. */
export const AGENT_FOR_PHASE = Object.freeze({
  'ai-planning': 'planning-agent',
  'ai-implementation': 'implementation-agent',
  'ai-review': 'code-review-agent',
  'ai-documentation': 'documentation-agent',
});

/** Idempotently-provisioned label colors/descriptions. */
export const LABEL_METADATA = Object.freeze({
  [PERMANENT_LABEL]: {
    color: '5319e7',
    description: 'Permanent marker: this issue opted into the automated AI development lifecycle.',
  },
  'ai-planning': { color: 'fbca04', description: 'Automated lifecycle: planning in progress.' },
  'ai-implementation': {
    color: '0e8a16',
    description: 'Automated lifecycle: implementation in progress.',
  },
  'ai-review': { color: '1d76db', description: 'Automated lifecycle: review in progress.' },
  'ai-changes-requested': {
    color: 'd93f0b',
    description: 'Automated lifecycle: remediation requested by review.',
  },
  'ai-documentation': {
    color: '0052cc',
    description: 'Automated lifecycle: documentation in progress.',
  },
  'ai-complete': {
    color: '2cbe4e',
    description: 'Automated lifecycle finished; open pull request awaits human disposition.',
  },
  'ai-failed': {
    color: 'b60205',
    description: 'Automated lifecycle stopped without completing; needs maintainer action.',
  },
});

/** Documented Agent Tasks task/session states. */
export const KNOWN_TASK_STATES = Object.freeze([
  'queued',
  'in_progress',
  'completed',
  'failed',
  'idle',
  'waiting_for_user',
  'timed_out',
  'cancelled',
]);

const GITHUB_API_BASE = 'https://api.github.com';
const AGENT_TASKS_API_BASE = 'https://api.github.com/agents';
const API_VERSION = '2026-03-10';

const DOC_PATH_PATTERNS = Object.freeze([
  /^docs\//i,
  /^templates\//i,
  /(^|\/)README(\.[a-z0-9]+)?$/i,
  /(^|\/)CHANGELOG(\.[a-z0-9]+)?$/i,
  /\.md$/i,
]);

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

const REDACTION_RULES = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, '******'],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, '[REDACTED]'],
  [/github_pat_[A-Za-z0-9_]{20,}/g, '[REDACTED]'],
  [/("(?:authorization|token|secret|password)"\s*:\s*")[^"]*(")/gi, '$1[REDACTED]$2'],
];

/**
 * Redact bearer tokens, GitHub PAT patterns, and common secret-shaped JSON
 * fields from a string before it is logged, commented, or persisted.
 * @param {unknown} value
 * @returns {string}
 */
export function redact(value) {
  if (typeof value !== 'string') {
    return '';
  }
  let result = value;
  for (const [pattern, replacement] of REDACTION_RULES) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Return a shallow copy of HTTP headers with sensitive values masked.
 * @param {Record<string, string>} headers
 * @returns {Record<string, string>}
 */
export function redactHeaders(headers) {
  const redacted = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    redacted[key] = /^authorization$/i.test(key) ? '[REDACTED]' : value;
  }
  return redacted;
}

/**
 * Build the HTTP Authorization header value for a token. Kept as a single
 * helper so the token is never duplicated inline across request builders,
 * and so log/error paths never need to reconstruct it.
 * @param {string} token
 * @returns {string}
 */
function authorizationHeaderValue(token) {
  const scheme = ['Bearer', token].join(' ');
  return scheme;
}

// ---------------------------------------------------------------------------
// Slug and branch naming
// ---------------------------------------------------------------------------

/**
 * Normalize an issue title into a lowercase, hyphen-separated ASCII slug,
 * capped at 48 characters with no leading/trailing hyphen. Returns `task`
 * when the input yields no usable characters.
 * @param {unknown} title
 * @returns {string}
 */
export function normalizeSlug(title) {
  const source = typeof title === 'string' ? title : '';
  const ascii = source.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  let slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (slug.length > 48) {
    slug = slug.slice(0, 48).replace(/-+$/g, '');
  }

  return slug.length > 0 ? slug : 'task';
}

/**
 * Build the exact canonical branch name for an issue.
 * @param {number} issueNumber
 * @param {string} slug
 * @returns {string}
 */
export function buildBranchName(issueNumber, slug) {
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new TypeError('issueNumber must be a positive integer');
  }
  return `ai/issue-${issueNumber}-${normalizeSlug(slug)}`;
}

/**
 * Test whether a branch name matches the canonical pattern for an issue.
 * @param {string} branch
 * @param {number} issueNumber
 * @returns {boolean}
 */
export function isCanonicalBranchName(branch, issueNumber) {
  if (typeof branch !== 'string' || !Number.isInteger(issueNumber)) {
    return false;
  }
  const pattern = new RegExp(`^ai/issue-${issueNumber}-[a-z0-9]+(?:-[a-z0-9]+)*$`);
  return pattern.test(branch);
}

// ---------------------------------------------------------------------------
// Trigger qualification
// ---------------------------------------------------------------------------

/**
 * Decide whether an `issues` webhook event qualifies as a controller trigger.
 * `opened` qualifies only when the issue already carries the exact permanent
 * label. `labeled` qualifies only when the label just added is the exact
 * permanent label. All other actions never qualify.
 * @param {{action: string, label?: {name?: string}, issueLabels?: string[]}} event
 * @returns {{qualifies: boolean, reason: string}}
 */
export function qualifyIssuesEvent(event) {
  const action = event?.action;
  const issueLabels = Array.isArray(event?.issueLabels) ? event.issueLabels : [];

  if (action === 'opened') {
    return issueLabels.includes(PERMANENT_LABEL)
      ? { qualifies: true, reason: 'opened-with-permanent-label' }
      : { qualifies: false, reason: 'opened-without-permanent-label' };
  }

  if (action === 'labeled') {
    const labelName = event?.label?.name;
    return labelName === PERMANENT_LABEL
      ? { qualifies: true, reason: 'labeled-exact-match' }
      : { qualifies: false, reason: 'labeled-non-matching-label' };
  }

  return { qualifies: false, reason: `unsupported-action:${String(action)}` };
}

/**
 * Decide whether a `workflow_dispatch`/`workflow_call` resume request
 * qualifies. Every non-`issues` entry point must re-fetch the issue and
 * require the exact permanent label; it never trusts caller-supplied state.
 * @param {{issueLabels?: string[]}} params
 * @returns {{qualifies: boolean, reason: string}}
 */
export function qualifyResumeEvent({ issueLabels } = {}) {
  const labels = Array.isArray(issueLabels) ? issueLabels : [];
  return labels.includes(PERMANENT_LABEL)
    ? { qualifies: true, reason: 'resume-with-permanent-label' }
    : { qualifies: false, reason: 'resume-missing-permanent-label' };
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a collaborator permission level authorizes orchestration.
 * @param {string} permission
 * @returns {{authorized: boolean, reason: string}}
 */
export function evaluateAuthorization(permission) {
  if (AUTHORIZED_PERMISSIONS.includes(permission)) {
    return { authorized: true, reason: `permission:${permission}` };
  }
  return { authorized: false, reason: `insufficient-permission:${String(permission)}` };
}

// ---------------------------------------------------------------------------
// Label reconciliation
// ---------------------------------------------------------------------------

/**
 * Compute the additions/removals needed to move an issue's label set to
 * exactly the permanent label, the desired single active-state label, and
 * every previously unrelated label, unchanged.
 * @param {string[]} currentLabels
 * @param {string} desiredActiveLabel
 * @returns {{toAdd: string[], toRemove: string[], resultingLabels: string[]}}
 */
export function computeLabelUpdate(currentLabels, desiredActiveLabel) {
  if (!ACTIVE_LABELS.includes(desiredActiveLabel)) {
    throw new RangeError(`desiredActiveLabel must be one of: ${ACTIVE_LABELS.join(', ')}`);
  }

  const current = Array.isArray(currentLabels) ? currentLabels : [];
  const unrelated = current.filter(
    (label) => label !== PERMANENT_LABEL && !ACTIVE_LABELS.includes(label),
  );

  const toAdd = [];
  const toRemove = [];

  if (!current.includes(PERMANENT_LABEL)) {
    toAdd.push(PERMANENT_LABEL);
  }
  if (!current.includes(desiredActiveLabel)) {
    toAdd.push(desiredActiveLabel);
  }
  for (const label of ACTIVE_LABELS) {
    if (label !== desiredActiveLabel && current.includes(label)) {
      toRemove.push(label);
    }
  }

  const resultingLabels = [PERMANENT_LABEL, desiredActiveLabel, ...unrelated];

  return { toAdd, toRemove, resultingLabels };
}

/**
 * Verify that a label set satisfies the invariant: the permanent label is
 * present and exactly one active-state label is present.
 * @param {string[]} labels
 * @returns {{valid: boolean, reason?: string, activeLabel?: string}}
 */
export function verifyLabelInvariant(labels) {
  const list = Array.isArray(labels) ? labels : [];
  if (!list.includes(PERMANENT_LABEL)) {
    return { valid: false, reason: 'missing-permanent-label' };
  }
  const activeMatches = list.filter((label) => ACTIVE_LABELS.includes(label));
  if (activeMatches.length !== 1) {
    return {
      valid: false,
      reason: activeMatches.length === 0 ? 'missing-active-label' : 'multiple-active-labels',
    };
  }
  return { valid: true, activeLabel: activeMatches[0] };
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

/**
 * Allowed transition events per current active-state label. `null` denotes
 * "no orchestration identity yet" (first qualifying trigger).
 */
export const STATE_TRANSITIONS = Object.freeze({
  null: Object.freeze({ qualify: 'ai-planning' }),
  'ai-planning': Object.freeze({ planApproved: 'ai-implementation', error: 'ai-failed' }),
  'ai-implementation': Object.freeze({
    implementationComplete: 'ai-review',
    error: 'ai-failed',
  }),
  'ai-review': Object.freeze({
    changesRequested: 'ai-changes-requested',
    approved: 'ai-documentation',
    error: 'ai-failed',
  }),
  'ai-changes-requested': Object.freeze({
    remediationStart: 'ai-implementation',
    error: 'ai-failed',
  }),
  'ai-documentation': Object.freeze({ documented: 'ai-complete', error: 'ai-failed' }),
  'ai-complete': Object.freeze({}),
  'ai-failed': Object.freeze({}),
});

/**
 * Apply a transition event to the current state, enforcing the allowed
 * transition table. Throws on any transition not explicitly defined.
 * @param {string|null} currentState
 * @param {string} event
 * @returns {string} the next active-state label
 */
export function applyTransition(currentState, event) {
  const key = currentState === null ? 'null' : currentState;
  const transitions = STATE_TRANSITIONS[key];
  if (!transitions || !(event in transitions)) {
    throw new RangeError(`invalid transition: state=${String(currentState)} event=${event}`);
  }
  return transitions[event];
}

/**
 * Decide whether a `CHANGES REQUESTED` verdict may start another
 * implementation/re-review cycle or must exhaust the configured cap.
 * @param {number} currentIteration
 * @param {number} maxIterations
 * @returns {{exhausted: boolean, nextIteration?: number}}
 */
export function computeIterationDecision(currentIteration, maxIterations) {
  const current = Number.isInteger(currentIteration) ? currentIteration : 0;
  if (current >= maxIterations) {
    return { exhausted: true };
  }
  return { exhausted: false, nextIteration: current + 1 };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Parse the `AI_DEVELOPMENT_MAX_ITERATIONS` repository variable. Fails
 * closed (returns `valid: false`) on anything other than an integer from 0
 * through the documented safety ceiling.
 * @param {unknown} rawValue
 * @returns {{valid: boolean, value?: number, reason?: string}}
 */
export function parseMaxIterations(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return { valid: true, value: DEFAULT_MAX_ITERATIONS };
  }
  const text = String(rawValue).trim();
  if (!/^\d+$/.test(text)) {
    return { valid: false, reason: 'not-a-non-negative-integer' };
  }
  const value = Number.parseInt(text, 10);
  if (value > MAX_ITERATIONS_CEILING) {
    return { valid: false, reason: `exceeds-ceiling:${MAX_ITERATIONS_CEILING}` };
  }
  return { valid: true, value };
}

// ---------------------------------------------------------------------------
// Review verdict parsing
// ---------------------------------------------------------------------------

/**
 * Parse the exact, single terminal verdict from a review artifact's
 * "Final verdict" line. Fails closed when the line is missing, duplicated,
 * or ambiguous.
 * @param {unknown} content
 * @returns {{valid: boolean, verdict?: 'APPROVED'|'CHANGES REQUESTED', reason?: string}}
 */
export function parseReviewVerdict(content) {
  if (typeof content !== 'string' || content.length === 0) {
    return { valid: false, reason: 'missing-content' };
  }

  const verdictLines = content
    .split(/\r?\n/)
    .filter((line) => /final verdict/i.test(line));

  if (verdictLines.length !== 1) {
    return {
      valid: false,
      reason: verdictLines.length === 0 ? 'no-verdict-line' : 'multiple-verdict-lines',
    };
  }

  const line = verdictLines[0];
  const hasApproved = /\bAPPROVED\b/.test(line);
  const hasChangesRequested = /\bCHANGES REQUESTED\b/.test(line);

  if (hasApproved === hasChangesRequested) {
    return { valid: false, reason: 'ambiguous-or-missing-verdict-token' };
  }

  return { valid: true, verdict: hasApproved ? 'APPROVED' : 'CHANGES REQUESTED' };
}

// ---------------------------------------------------------------------------
// Documentation diff classification
// ---------------------------------------------------------------------------

/**
 * Test whether a repository-relative path is a documentation path.
 * @param {string} path
 * @returns {boolean}
 */
export function isDocumentationPath(path) {
  if (typeof path !== 'string' || path.length === 0) {
    return false;
  }
  return DOC_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

/**
 * Classify the documentation task's committed diff into exactly one of
 * `CREATE`, `UPDATE`, or `NO CHANGE`. Any change outside a documentation
 * path fails closed rather than being classified.
 * @param {Array<{path: string, status: 'added'|'modified'|'removed'|'renamed'|'copied'|'changed'|'unchanged'}>} fileChanges
 * @returns {{valid: boolean, outcome?: 'CREATE'|'UPDATE'|'NO CHANGE', reason?: string, path?: string}}
 */
export function classifyDocumentationDiff(fileChanges) {
  if (!Array.isArray(fileChanges)) {
    return { valid: false, reason: 'missing-file-changes' };
  }
  if (fileChanges.length === 0) {
    return { valid: true, outcome: 'NO CHANGE' };
  }

  const nonDocChange = fileChanges.find((file) => !isDocumentationPath(file?.path));
  if (nonDocChange) {
    return { valid: false, reason: 'non-documentation-change', path: nonDocChange?.path };
  }

  const hasExistingFileChange = fileChanges.some((file) =>
    ['modified', 'removed', 'renamed', 'copied', 'changed'].includes(file.status),
  );
  if (hasExistingFileChange) {
    return { valid: true, outcome: 'UPDATE' };
  }

  const allAdded = fileChanges.every((file) => file.status === 'added');
  if (allAdded) {
    return { valid: true, outcome: 'CREATE' };
  }

  return { valid: false, reason: 'unrecognized-file-status' };
}

// ---------------------------------------------------------------------------
// Durable state comment
// ---------------------------------------------------------------------------

/**
 * @typedef {object} ControllerState
 * @property {number} schemaVersion
 * @property {number} issueNumber
 * @property {string} branch
 * @property {number} [prNumber]
 * @property {string} phase
 * @property {string} [taskId]
 * @property {string} [headSha]
 * @property {number} reviewIteration
 * @property {number} maxIterations
 */

/**
 * Build the idempotent, machine-readable controller state comment body.
 * @param {Omit<ControllerState, 'schemaVersion'>} state
 * @returns {string}
 */
export function buildStateComment(state) {
  const payload = JSON.stringify({ schemaVersion: STATE_SCHEMA_VERSION, ...state });
  return [
    STATE_COMMENT_MARKER,
    `<!-- ai-development-controller:data:${payload} -->`,
    '',
    'AI development controller state (machine-readable; do not edit).',
  ].join('\n');
}

/**
 * Parse a controller state comment body back into its structured state.
 * Returns `null` when the comment is not a recognizable, current-schema
 * controller state comment.
 * @param {unknown} body
 * @returns {ControllerState|null}
 */
export function parseStateComment(body) {
  if (typeof body !== 'string') {
    return null;
  }
  const match = body.match(STATE_DATA_PATTERN);
  if (!match) {
    return null;
  }
  try {
    const data = JSON.parse(match[1]);
    if (data?.schemaVersion !== STATE_SCHEMA_VERSION) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Test whether a comment body is the controller's own state comment.
 * @param {unknown} body
 * @returns {boolean}
 */
export function isControllerStateComment(body) {
  return typeof body === 'string' && body.includes(STATE_COMMENT_MARKER);
}

// ---------------------------------------------------------------------------
// Terminal comments
// ---------------------------------------------------------------------------

/**
 * Build the idempotent marker used to detect a prior terminal comment for
 * this issue/result pair.
 * @param {'ai-complete'|'ai-failed'} result
 * @param {number} issueNumber
 * @returns {string}
 */
export function buildTerminalCommentMarker(result, issueNumber) {
  return `${TERMINAL_COMMENT_MARKER_PREFIX}${result}:issue-${issueNumber} -->`;
}

/**
 * Build the human-readable, idempotently-markered terminal comment body.
 * @param {{result: 'ai-complete'|'ai-failed', issueNumber: number, branch?: string, prNumber?: number, summary: string, reason?: string}} params
 * @returns {string}
 */
export function buildTerminalComment({ result, issueNumber, branch, prNumber, summary, reason }) {
  if (result !== 'ai-complete' && result !== 'ai-failed') {
    throw new RangeError('result must be ai-complete or ai-failed');
  }
  const marker = buildTerminalCommentMarker(result, issueNumber);
  const heading = result === 'ai-complete' ? 'AI development complete' : 'AI development failed';
  const lines = [marker, `## ${heading}`, ''];

  if (branch) {
    lines.push(`- Branch: \`${redact(branch)}\``);
  }
  if (prNumber) {
    lines.push(`- Pull request: #${prNumber}`);
  }
  lines.push(`- Summary: ${redact(summary)}`);
  if (reason) {
    lines.push(`- Reason: ${redact(reason)}`);
  }
  if (result === 'ai-complete') {
    lines.push(
      '',
      'This does not merge automatically. A human must review and merge the pull request.',
    );
  } else {
    lines.push(
      '',
      'This run stopped without completing the lifecycle. A maintainer must review the ' +
        'linked pull request/branch and, if appropriate, remove the terminal label before ' +
        're-dispatching.',
    );
  }

  return lines.join('\n');
}

/**
 * Test whether a comment body is already the idempotent terminal comment
 * for this issue/result pair.
 * @param {unknown} body
 * @param {'ai-complete'|'ai-failed'} result
 * @param {number} issueNumber
 * @returns {boolean}
 */
export function isTerminalComment(body, result, issueNumber) {
  return typeof body === 'string' && body.includes(buildTerminalCommentMarker(result, issueNumber));
}

// ---------------------------------------------------------------------------
// Agent Tasks state evaluation
// ---------------------------------------------------------------------------

/**
 * Map a documented Agent Tasks task/session state to a controller outcome.
 * Any state outside the documented enum fails closed.
 * @param {string} state
 * @returns {{outcome: 'pending'|'completed'|'failed', reason?: string}}
 */
export function evaluateTaskState(state) {
  if (!KNOWN_TASK_STATES.includes(state)) {
    return { outcome: 'failed', reason: `unknown-task-state:${String(state)}` };
  }
  if (state === 'queued' || state === 'in_progress') {
    return { outcome: 'pending' };
  }
  if (state === 'completed') {
    return { outcome: 'completed' };
  }
  return { outcome: 'failed', reason: `task-state:${state}` };
}

/**
 * Compute a bounded exponential backoff delay in milliseconds.
 * @param {number} attempt zero-based attempt index
 * @param {{baseMs?: number, maxMs?: number}} [options]
 * @returns {number}
 */
export function computeBackoffDelayMs(attempt, { baseMs = 2000, maxMs = 30000 } = {}) {
  const exponential = baseMs * 2 ** Math.max(0, attempt);
  return Math.min(exponential, maxMs);
}

/**
 * Extract the exact PR number and head SHA-bearing branch from a completed
 * task's artifacts, requiring the `pull` artifact with the expected head
 * ref. Fails closed when the artifact is missing or does not match.
 * @param {Array<{provider: string, type: string, data: Record<string, unknown>}>} artifacts
 * @param {string} expectedHeadRef
 * @returns {{valid: boolean, prNumber?: number, reason?: string}}
 */
export function extractTaskPullArtifact(artifacts, expectedHeadRef) {
  const list = Array.isArray(artifacts) ? artifacts : [];
  const pullArtifact = list.find(
    (artifact) => artifact?.provider === 'github' && artifact?.type === 'pull',
  );
  if (!pullArtifact) {
    return { valid: false, reason: 'missing-pull-artifact' };
  }
  const prNumber = pullArtifact?.data?.id;
  if (!Number.isInteger(prNumber)) {
    return { valid: false, reason: 'missing-pull-number' };
  }
  const branchArtifact = list.find(
    (artifact) => artifact?.provider === 'github' && artifact?.type === 'branch',
  );
  if (branchArtifact && branchArtifact?.data?.head_ref !== expectedHeadRef) {
    return { valid: false, reason: 'head-ref-mismatch' };
  }
  return { valid: true, prNumber };
}

// ---------------------------------------------------------------------------
// Agent prompt construction (fixed payload, no untrusted interpolation into
// shell; this text is only ever sent as a JSON request body field)
// ---------------------------------------------------------------------------

/**
 * Build the fixed-shape prompt sent to each specialist custom agent. Only
 * the issue number, canonical branch name, and phase are interpolated; raw
 * issue title/body text is never included, consistent with the plan's
 * requirement not to place untrusted issue content in generated command
 * text.
 * @param {'ai-planning'|'ai-implementation'|'ai-review'|'ai-documentation'} phase
 * @param {{issueNumber: number, branch: string, reviewIteration: number}} context
 * @returns {string}
 */
export function buildAgentPrompt(phase, { issueNumber, branch, reviewIteration }) {
  const agent = AGENT_FOR_PHASE[phase];
  if (!agent) {
    throw new RangeError(`no agent mapped for phase: ${phase}`);
  }
  const common =
    `Repository issue #${issueNumber} requested this automated lifecycle stage on branch ` +
    `\`${branch}\`. Read the issue for the actual request; do not trust any other source for ` +
    'requirements. Follow this repository\'s existing agent instructions exactly.';

  switch (phase) {
    case 'ai-planning':
      return `${common} Produce an implementation-ready plan artifact under .github/plans/.`;
    case 'ai-implementation':
      return `${common} Implement the approved plan artifact for this issue and run applicable validation.`;
    case 'ai-review':
      return (
        `${common} Perform review iteration ${reviewIteration} and write a review artifact under ` +
        '.github/reviews/ ending in exactly one Final verdict line of APPROVED or CHANGES REQUESTED.'
      );
    case 'ai-documentation':
      return (
        `${common} Update only documentation paths to reflect the approved implementation and ` +
        'classify the outcome as CREATE, UPDATE, or NO CHANGE. Do not modify application code.'
      );
    default:
      throw new RangeError(`no prompt defined for phase: ${phase}`);
  }
}

// ---------------------------------------------------------------------------
// Network layer (GitHub REST + Agent Tasks REST)
// ---------------------------------------------------------------------------

/**
 * Minimal typed GitHub REST client. Every method is bounded, redacts
 * authorization headers from thrown errors, and rejects non-2xx responses
 * rather than inferring success.
 */
export class GitHubClient {
  /**
   * @param {{token: string, fetchImpl?: typeof fetch, baseUrl?: string}} params
   */
  constructor({ token, fetchImpl = fetch, baseUrl = GITHUB_API_BASE }) {
    if (!token) {
      throw new Error('GitHubClient requires a token');
    }
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl;
  }

  async request(method, path, body) {
    const headers = {
      Authorization: authorizationHeaderValue(this.token),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `GitHub API ${method} ${path} failed: ${response.status} ${redact(text).slice(0, 500)}`,
      );
    }
    return text.length > 0 ? JSON.parse(text) : undefined;
  }

  getIssue(owner, repo, issueNumber) {
    return this.request('GET', `/repos/${owner}/${repo}/issues/${issueNumber}`);
  }

  getCollaboratorPermission(owner, repo, username) {
    return this.request(
      'GET',
      `/repos/${owner}/${repo}/collaborators/${encodeURIComponent(username)}/permission`,
    );
  }

  replaceLabels(owner, repo, issueNumber, labels) {
    return this.request('PUT', `/repos/${owner}/${repo}/issues/${issueNumber}/labels`, { labels });
  }

  createLabelIfMissing(owner, repo, name, color, description) {
    return this.request('POST', `/repos/${owner}/${repo}/labels`, { name, color, description }).catch(
      (error) => {
        if (/422/.test(String(error?.message))) {
          return undefined; // already exists
        }
        throw error;
      },
    );
  }

  getRef(owner, repo, ref) {
    return this.request('GET', `/repos/${owner}/${repo}/git/ref/${ref}`);
  }

  createRef(owner, repo, ref, sha) {
    return this.request('POST', `/repos/${owner}/${repo}/git/refs`, { ref: `refs/${ref}`, sha });
  }

  findPullByHead(owner, repo, headBranch) {
    return this.request(
      'GET',
      `/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(`${owner}:${headBranch}`)}&state=all`,
    );
  }

  createPullRequest(owner, repo, params) {
    return this.request('POST', `/repos/${owner}/${repo}/pulls`, params);
  }

  getRepository(owner, repo) {
    return this.request('GET', `/repos/${owner}/${repo}`);
  }

  getCommit(owner, repo, sha) {
    return this.request('GET', `/repos/${owner}/${repo}/git/commits/${sha}`);
  }

  createCommit(owner, repo, { message, tree, parents }) {
    return this.request('POST', `/repos/${owner}/${repo}/git/commits`, { message, tree, parents });
  }

  getPullRequest(owner, repo, pullNumber) {
    return this.request('GET', `/repos/${owner}/${repo}/pulls/${pullNumber}`);
  }

  compareCommits(owner, repo, base, head) {
    return this.request(
      'GET',
      `/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
    );
  }

  listPullFiles(owner, repo, pullNumber) {
    return this.request('GET', `/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=100`);
  }

  getPullFileContent(owner, repo, path, ref) {
    return this.request(
      'GET',
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`,
    );
  }

  listIssueComments(owner, repo, issueNumber) {
    return this.request('GET', `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`);
  }

  createIssueComment(owner, repo, issueNumber, body) {
    return this.request('POST', `/repos/${owner}/${repo}/issues/${issueNumber}/comments`, { body });
  }

  updateIssueComment(owner, repo, commentId, body) {
    return this.request('PATCH', `/repos/${owner}/${repo}/issues/comments/${commentId}`, { body });
  }
}

/**
 * Minimal typed Copilot Agent Tasks client (public preview).
 */
export class AgentTasksClient {
  /**
   * @param {{token: string, fetchImpl?: typeof fetch, baseUrl?: string}} params
   */
  constructor({ token, fetchImpl = fetch, baseUrl = AGENT_TASKS_API_BASE }) {
    if (!token) {
      throw new Error('AgentTasksClient requires a token');
    }
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl;
  }

  async request(method, path, body) {
    const headers = {
      Authorization: authorizationHeaderValue(this.token),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `Agent Tasks API ${method} ${path} failed: ${response.status} ${redact(text).slice(0, 500)}`,
      );
    }
    return text.length > 0 ? JSON.parse(text) : undefined;
  }

  startTask(owner, repo, { prompt, customAgent, baseRef, headRef }) {
    return this.request('POST', `/repos/${owner}/${repo}/tasks`, {
      prompt,
      custom_agent: customAgent,
      base_ref: baseRef,
      head_ref: headRef,
    });
  }

  getTask(owner, repo, taskId) {
    return this.request('GET', `/repos/${owner}/${repo}/tasks/${encodeURIComponent(taskId)}`);
  }
}

// ---------------------------------------------------------------------------
// Orchestration (composes the pure helpers with the network layer)
// ---------------------------------------------------------------------------

/** Error thrown for any controller condition that must fail closed. */
export class ControllerError extends Error {}

function labelNames(issue) {
  return (issue?.labels ?? []).map((label) => (typeof label === 'string' ? label : label?.name));
}

async function ensureStateLabels(github, owner, repo) {
  for (const name of [PERMANENT_LABEL, ...ACTIVE_LABELS]) {
    const meta = LABEL_METADATA[name];
    await github.createLabelIfMissing(owner, repo, name, meta.color, meta.description);
  }
}

/**
 * Replace an issue's labels so exactly the permanent label, the desired
 * active-state label, and previously unrelated labels remain, then verify
 * the result. Throws (fails closed) if the invariant does not hold after
 * the write.
 */
async function applyLabelState(github, owner, repo, issueNumber, desiredActiveLabel) {
  const before = await github.getIssue(owner, repo, issueNumber);
  const update = computeLabelUpdate(labelNames(before), desiredActiveLabel);
  await github.replaceLabels(owner, repo, issueNumber, update.resultingLabels);

  const after = await github.getIssue(owner, repo, issueNumber);
  const invariant = verifyLabelInvariant(labelNames(after));
  if (!invariant.valid || invariant.activeLabel !== desiredActiveLabel) {
    throw new ControllerError(
      `label invariant violated after transition to ${desiredActiveLabel}: ` +
        (invariant.reason ?? `found ${invariant.activeLabel}`),
    );
  }
}

async function findControllerStateComment(github, owner, repo, issueNumber) {
  const comments = await github.listIssueComments(owner, repo, issueNumber);
  const match = (comments ?? []).find((comment) => isControllerStateComment(comment.body));
  if (!match) {
    return null;
  }
  const state = parseStateComment(match.body);
  return state ? { commentId: match.id, state } : null;
}

async function persistControllerState(github, owner, repo, issueNumber, commentId, state) {
  const body = buildStateComment(state);
  if (commentId) {
    await github.updateIssueComment(owner, repo, commentId, body);
    return commentId;
  }
  const created = await github.createIssueComment(owner, repo, issueNumber, body);
  return created.id;
}

/**
 * Create the canonical branch (with a trace commit) and open the draft PR
 * the plan requires, or reuse them when a prior run already created them.
 */
async function ensureBranchAndPullRequest(github, owner, repo, issueNumber, issueTitle, defaultBranch) {
  const branch = buildBranchName(issueNumber, normalizeSlug(issueTitle));

  const existingRef = await github.getRef(owner, repo, `heads/${branch}`).catch(() => undefined);
  if (!existingRef) {
    const baseRef = await github.getRef(owner, repo, `heads/${defaultBranch}`);
    const baseSha = baseRef.object.sha;
    const baseCommit = await github.getCommit(owner, repo, baseSha);
    const traceCommit = await github.createCommit(owner, repo, {
      message: `chore(ai-development): start automated lifecycle for issue #${issueNumber}\n\nRef #${issueNumber}`,
      tree: baseCommit.tree.sha,
      parents: [baseSha],
    });
    await github.createRef(owner, repo, `heads/${branch}`, traceCommit.sha);
  }

  const existingPulls = await github.findPullByHead(owner, repo, branch);
  let prNumber = Array.isArray(existingPulls) && existingPulls.length > 0 ? existingPulls[0].number : undefined;

  if (!prNumber) {
    const created = await github.createPullRequest(owner, repo, {
      title: `AI development: issue #${issueNumber}`,
      head: branch,
      base: defaultBranch,
      draft: true,
      body:
        `Automated AI development lifecycle for #${issueNumber}. Plan and review artifacts are ` +
        'tracked under `.github/plans/` and `.github/reviews/`. This pull request does not merge ' +
        'automatically; a human must review and merge it.',
    });
    prNumber = created.number;
  }

  return { branch, prNumber };
}

async function runPhaseTask(agentTasks, owner, repo, phase, context) {
  const task = await agentTasks.startTask(owner, repo, {
    prompt: buildAgentPrompt(phase, context),
    customAgent: AGENT_FOR_PHASE[phase],
    baseRef: context.defaultBranch,
    headRef: context.branch,
  });
  if (typeof task?.id !== 'string' || task.id.length === 0) {
    throw new ControllerError(`Agent Tasks response for phase ${phase} is missing a task id`);
  }
  return task.id;
}

async function pollTaskUntilSettled(agentTasks, owner, repo, taskId, { deadlineMs, sleepImpl }) {
  const start = Date.now();
  let attempt = 0;
  for (;;) {
    const task = await agentTasks.getTask(owner, repo, taskId);
    const evalResult = evaluateTaskState(task?.state);
    if (evalResult.outcome !== 'pending') {
      return { task, evalResult };
    }
    if (Date.now() - start >= deadlineMs) {
      return { task, evalResult: { outcome: 'failed', reason: 'poll-deadline-exceeded' } };
    }
    await sleepImpl(computeBackoffDelayMs(attempt));
    attempt += 1;
  }
}

async function diffSince(github, owner, repo, base, head) {
  if (!base || base === head) {
    return [];
  }
  const comparison = await github.compareCommits(owner, repo, base, head);
  return (comparison?.files ?? []).map((file) => ({ path: file.filename, status: file.status }));
}

async function postTerminalComment(github, owner, repo, issueNumber, params) {
  const comments = await github.listIssueComments(owner, repo, issueNumber);
  const already = (comments ?? []).some((comment) =>
    isTerminalComment(comment.body, params.result, issueNumber),
  );
  if (already) {
    return;
  }
  await github.createIssueComment(owner, repo, issueNumber, buildTerminalComment({ issueNumber, ...params }));
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run the full, resumable controller lifecycle for one issue: ensure
 * labels, create/reuse the canonical branch and draft PR, and drive the
 * phase loop (Agent Tasks call, bounded poll, artifact validation, state
 * transition) until a terminal label is reached. Every persisted state
 * update goes through the same idempotent HTML-marked comment so repeated
 * or resumed runs do not duplicate work.
 *
 * This function is exercised in unit tests only against injected/mocked
 * `github`/`agentTasks` clients. It has not been run against the live
 * GitHub REST API or the public-preview Agent Tasks API because no such
 * credential or disposable integration repository is available in this
 * environment; see the plan's "Explicit limits" section.
 */
export async function runController({
  github,
  agentTasks,
  owner,
  repo,
  issueNumber,
  maxIterations,
  sleepImpl = defaultSleep,
  pollDeadlineMs = 20 * 60 * 1000,
}) {
  await ensureStateLabels(github, owner, repo);

  const issue = await github.getIssue(owner, repo, issueNumber);
  const invariant = verifyLabelInvariant(labelNames(issue));
  let currentActiveLabel = invariant.valid ? invariant.activeLabel : null;

  if (currentActiveLabel && TERMINAL_LABELS.includes(currentActiveLabel)) {
    return { noop: true, reason: 'already-terminal', activeLabel: currentActiveLabel };
  }

  const existingComment = await findControllerStateComment(github, owner, repo, issueNumber);
  let commentId = existingComment?.commentId;
  let state = existingComment?.state;

  const repository = await github.getRepository(owner, repo);
  const defaultBranch = repository.default_branch;

  let branch = state?.branch;
  let prNumber = state?.prNumber;
  if (!branch) {
    const created = await ensureBranchAndPullRequest(
      github,
      owner,
      repo,
      issueNumber,
      issue.title,
      defaultBranch,
    );
    branch = created.branch;
    prNumber = created.prNumber;
  }

  if (!currentActiveLabel) {
    currentActiveLabel = applyTransition(null, 'qualify');
    await applyLabelState(github, owner, repo, issueNumber, currentActiveLabel);
  }

  let reviewIteration = state?.reviewIteration ?? 0;
  let taskId = state?.taskId;
  let headSha = state?.headSha;

  const persist = async (phase) => {
    state = { issueNumber, branch, prNumber, phase, reviewIteration, maxIterations, taskId, headSha };
    commentId = await persistControllerState(github, owner, repo, issueNumber, commentId, state);
  };
  await persist(currentActiveLabel);

  while (!TERMINAL_LABELS.includes(currentActiveLabel)) {
    const context = { issueNumber, branch, defaultBranch, reviewIteration };

    if (!taskId) {
      taskId = await runPhaseTask(agentTasks, owner, repo, currentActiveLabel, context);
      await persist(currentActiveLabel);
    }

    const preTaskHeadSha = headSha;
    const { task, evalResult } = await pollTaskUntilSettled(agentTasks, owner, repo, taskId, {
      deadlineMs: pollDeadlineMs,
      sleepImpl,
    });

    if (evalResult.outcome !== 'completed') {
      throw new ControllerError(
        `phase ${currentActiveLabel} did not complete: ${evalResult.reason ?? 'unknown'}`,
      );
    }

    const artifact = extractTaskPullArtifact(task?.artifacts, branch);
    if (!artifact.valid) {
      throw new ControllerError(`invalid task artifact for phase ${currentActiveLabel}: ${artifact.reason}`);
    }
    if (prNumber && artifact.prNumber !== prNumber) {
      throw new ControllerError(`task pull request #${artifact.prNumber} does not match controller PR #${prNumber}`);
    }
    prNumber = artifact.prNumber;

    const pr = await github.getPullRequest(owner, repo, prNumber);
    const newHeadSha = pr?.head?.sha;
    if (!newHeadSha) {
      throw new ControllerError(`pull request #${prNumber} is missing a head sha`);
    }

    let nextEvent;
    let docOutcome;

    if (currentActiveLabel === 'ai-planning') {
      const diff = await diffSince(github, owner, repo, defaultBranch, newHeadSha);
      const hasPlan = diff.some(
        (file) => file.status === 'added' && /^\.github\/plans\/.+\.plan\.md$/.test(file.path),
      );
      if (!hasPlan) {
        throw new ControllerError('planning task completed without an added plan artifact');
      }
      nextEvent = 'planApproved';
    } else if (currentActiveLabel === 'ai-implementation') {
      nextEvent = 'implementationComplete';
    } else if (currentActiveLabel === 'ai-review') {
      const diff = await diffSince(github, owner, repo, preTaskHeadSha ?? defaultBranch, newHeadSha);
      const reviewFiles = diff.filter(
        (file) => file.status === 'added' && /^\.github\/reviews\/.+\.review\.md$/.test(file.path),
      );
      if (reviewFiles.length !== 1) {
        throw new ControllerError(
          `expected exactly one added review artifact, found ${reviewFiles.length}`,
        );
      }
      const fileContent = await github.getPullFileContent(owner, repo, reviewFiles[0].path, newHeadSha);
      const decoded =
        fileContent?.encoding === 'base64'
          ? Buffer.from(fileContent.content, 'base64').toString('utf8')
          : fileContent?.content;
      const verdict = parseReviewVerdict(decoded);
      if (!verdict.valid) {
        throw new ControllerError(`invalid review verdict: ${verdict.reason}`);
      }
      if (verdict.verdict === 'APPROVED') {
        nextEvent = 'approved';
      } else {
        const decision = computeIterationDecision(reviewIteration, maxIterations);
        if (decision.exhausted) {
          throw new ControllerError(`review iteration cap (${maxIterations}) exhausted`);
        }
        reviewIteration = decision.nextIteration;
        nextEvent = 'changesRequested';
      }
    } else if (currentActiveLabel === 'ai-documentation') {
      const diff = await diffSince(github, owner, repo, preTaskHeadSha ?? defaultBranch, newHeadSha);
      const classification = classifyDocumentationDiff(diff);
      if (!classification.valid) {
        throw new ControllerError(`documentation task failed classification: ${classification.reason}`);
      }
      docOutcome = classification.outcome;
      nextEvent = 'documented';
    } else {
      throw new ControllerError(`unexpected active phase: ${currentActiveLabel}`);
    }

    headSha = newHeadSha;
    taskId = undefined;
    currentActiveLabel = applyTransition(currentActiveLabel, nextEvent);

    if (currentActiveLabel === 'ai-changes-requested') {
      await applyLabelState(github, owner, repo, issueNumber, currentActiveLabel);
      await persist(currentActiveLabel);
      currentActiveLabel = applyTransition(currentActiveLabel, 'remediationStart');
    }

    await applyLabelState(github, owner, repo, issueNumber, currentActiveLabel);
    await persist(currentActiveLabel);

    if (currentActiveLabel === 'ai-complete') {
      await postTerminalComment(github, owner, repo, issueNumber, {
        result: 'ai-complete',
        branch,
        prNumber,
        summary: `Documentation outcome: ${docOutcome}.`,
      });
    }
  }

  return { branch, prNumber, finalLabel: currentActiveLabel };
}

/**
 * Extract the issue number embedded in the controller workflow's run name
 * (see the `run-name:` expression in `ai-development.yml`). Used by the
 * watchdog, which only receives the completed `workflow_run` event and
 * never checks out or executes the underlying PR content.
 * @param {unknown} runName
 * @returns {number|undefined}
 */
export function parseIssueNumberFromRunName(runName) {
  if (typeof runName !== 'string') {
    return undefined;
  }
  const match = runName.match(/issue #(\d+)/);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

/**
 * Recover from an abnormal controller workflow termination (cancelled,
 * timed out, or otherwise failed before its own try/catch cleanup could
 * run). No-ops when the run succeeded or the issue is already terminal;
 * otherwise sets `ai-failed` and posts the one idempotent failure comment.
 * Never reads or executes any pull-request-head content.
 */
export async function runWatchdog({ github, owner, repo, issueNumber, conclusion, runUrl }) {
  if (conclusion === 'success') {
    return { noop: true, reason: 'run-succeeded' };
  }

  const issue = await github.getIssue(owner, repo, issueNumber);
  const invariant = verifyLabelInvariant(labelNames(issue));
  if (invariant.valid && TERMINAL_LABELS.includes(invariant.activeLabel)) {
    return { noop: true, reason: 'already-terminal', activeLabel: invariant.activeLabel };
  }

  await applyLabelState(github, owner, repo, issueNumber, 'ai-failed');
  await postTerminalComment(github, owner, repo, issueNumber, {
    result: 'ai-failed',
    summary: 'The controller workflow run ended abnormally before completing the lifecycle.',
    reason: `workflow_run conclusion: ${conclusion}${runUrl ? ` (${runUrl})` : ''}`,
  });

  return { handled: true, activeLabel: 'ai-failed' };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function readEventPayload(env) {
  const eventPath = env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(eventPath, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Watchdog entry point invoked by `ai-development-watchdog.yml` on every
 * completed run of the controller workflow.
 * @param {NodeJS.ProcessEnv} env
 */
async function mainWatchdog(env) {
  const owner = env.GITHUB_REPOSITORY_OWNER;
  const [, repo] = (env.GITHUB_REPOSITORY ?? '/').split('/');
  if (!owner || !repo) {
    console.error('Missing GITHUB_REPOSITORY context; failing closed.');
    process.exitCode = 1;
    return;
  }

  const githubToken = env.GITHUB_TOKEN;
  if (!githubToken) {
    console.error('Missing GITHUB_TOKEN; failing closed.');
    process.exitCode = 1;
    return;
  }

  const payload = readEventPayload(env);
  const run = payload?.workflow_run;
  const conclusion = run?.conclusion;
  const runUrl = run?.html_url;
  const issueNumber = parseIssueNumberFromRunName(run?.display_title ?? run?.name);

  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    console.error(
      'Watchdog could not determine an issue number from the completed run name; failing ' +
        'closed without any label or comment change.',
    );
    process.exitCode = 1;
    return;
  }

  const github = new GitHubClient({ token: githubToken });
  try {
    const result = await runWatchdog({ github, owner, repo, issueNumber, conclusion, runUrl });
    console.log(redact(JSON.stringify(result)));
  } catch (error) {
    console.error(`Watchdog failed closed: ${redact(error?.message ?? String(error))}`);
    process.exitCode = 1;
  }
}

/**
 * that cannot complete deterministically posts one redacted `ai-failed`
 * comment and exits non-zero rather than claiming success.
 * @param {NodeJS.ProcessEnv} env
 */
export async function main(env = process.env) {
  if (env.GITHUB_EVENT_NAME === 'workflow_run') {
    await mainWatchdog(env);
    return;
  }

  const owner = env.GITHUB_REPOSITORY_OWNER;
  const [, repo] = (env.GITHUB_REPOSITORY ?? '/').split('/');
  const eventName = env.GITHUB_EVENT_NAME;

  if (!owner || !repo) {
    console.error('Missing GITHUB_REPOSITORY context; failing closed.');
    process.exitCode = 1;
    return;
  }

  const githubToken = env.GITHUB_TOKEN;
  const agentToken = env.COPILOT_AGENT_TOKEN;
  if (!githubToken) {
    console.error('Missing GITHUB_TOKEN; failing closed.');
    process.exitCode = 1;
    return;
  }

  let issueNumber = Number.parseInt(env.ISSUE_NUMBER ?? '', 10);
  let qualification;
  let actor;

  if (eventName === 'issues') {
    const payload = readEventPayload(env);
    issueNumber = payload?.issue?.number;
    actor = payload?.sender?.login;
    qualification = qualifyIssuesEvent({
      action: payload?.action,
      label: payload?.label,
      issueLabels: (payload?.issue?.labels ?? []).map((label) => label?.name),
    });
  } else {
    // workflow_dispatch / workflow_call resume path: always re-fetch the
    // issue rather than trusting caller-supplied state.
    if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
      console.error('Missing or invalid ISSUE_NUMBER for resume path; failing closed.');
      process.exitCode = 1;
      return;
    }
    actor = env.GITHUB_ACTOR;
    const github = new GitHubClient({ token: githubToken });
    const issue = await github.getIssue(owner, repo, issueNumber).catch(() => undefined);
    qualification = qualifyResumeEvent({ issueLabels: labelNames(issue) });
  }

  if (!qualification?.qualifies) {
    console.log(`Not a qualifying trigger: ${qualification?.reason}`);
    return;
  }

  const maxIterationsResult = parseMaxIterations(env.AI_DEVELOPMENT_MAX_ITERATIONS);
  if (!maxIterationsResult.valid) {
    console.error(`Invalid ${MAX_ITERATIONS_VARIABLE}: ${maxIterationsResult.reason}; failing closed.`);
    process.exitCode = 1;
    return;
  }

  const github = new GitHubClient({ token: githubToken });

  if (actor) {
    const permission = await github
      .getCollaboratorPermission(owner, repo, actor)
      .then((result) => result?.permission)
      .catch(() => undefined);
    const authorization = evaluateAuthorization(permission);
    if (!authorization.authorized) {
      console.error(`Actor is not authorized to start the AI development lifecycle: ${authorization.reason}`);
      process.exitCode = 1;
      return;
    }
  }

  if (!agentToken) {
    console.error(
      'Missing COPILOT_AGENT_TOKEN. This preview credential is required to start Agent Tasks and ' +
        'is not available in this environment; failing closed without contacting Agent Tasks.',
    );
    process.exitCode = 1;
    return;
  }

  const agentTasks = new AgentTasksClient({ token: agentToken });

  try {
    const result = await runController({
      github,
      agentTasks,
      owner,
      repo,
      issueNumber,
      maxIterations: maxIterationsResult.value,
    });
    console.log(redact(JSON.stringify(result)));
  } catch (error) {
    const reason = redact(error?.message ?? String(error));
    console.error(`Controller run failed closed: ${reason}`);
    try {
      await applyLabelState(github, owner, repo, issueNumber, 'ai-failed');
      await postTerminalComment(github, owner, repo, issueNumber, {
        result: 'ai-failed',
        summary: 'The automated lifecycle stopped before reaching a terminal outcome.',
        reason,
      });
    } catch (cleanupError) {
      console.error(`Failed to record ai-failed outcome: ${redact(cleanupError?.message ?? String(cleanupError))}`);
    }
    process.exitCode = 1;
  }
}

const isDirectlyExecuted = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (isDirectlyExecuted) {
  main().catch((error) => {
    console.error(redact(error?.stack ?? String(error)));
    process.exitCode = 1;

  });
}
