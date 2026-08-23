import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as controller from './ai-development-controller.mjs';

const {
  PERMANENT_LABEL,
  ACTIVE_LABELS,
  TERMINAL_LABELS,
  DEFAULT_MAX_ITERATIONS,
  MAX_ITERATIONS_CEILING,
  AGENT_FOR_PHASE,
  KNOWN_TASK_STATES,
  redact,
  redactHeaders,
  normalizeSlug,
  buildBranchName,
  isCanonicalBranchName,
  qualifyIssuesEvent,
  qualifyResumeEvent,
  evaluateAuthorization,
  computeLabelUpdate,
  verifyLabelInvariant,
  applyTransition,
  computeIterationDecision,
  parseMaxIterations,
  parseReviewVerdict,
  isDocumentationPath,
  classifyDocumentationDiff,
  buildStateComment,
  parseStateComment,
  isControllerStateComment,
  buildTerminalCommentMarker,
  buildTerminalComment,
  isTerminalComment,
  evaluateTaskState,
  computeBackoffDelayMs,
  extractTaskPullArtifact,
  buildAgentPrompt,
  GitHubClient,
  AgentTasksClient,
  ControllerError,
  runController,
  parseIssueNumberFromRunName,
  runWatchdog,
} = controller;

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

describe('redact', () => {
  test('masks ******', () => {
    const secret = ['Bearer', 'abcDEF123.-_~+/=xyz'].join(' ');
    const result = redact(`Authorization: ${secret}`);
    assert.equal(result.includes('abcDEF123'), false);
  });

  test('masks GitHub PAT-shaped tokens', () => {
    const token = 'ghp_' + 'a'.repeat(36);
    assert.equal(redact(`token=${token}`).includes(token), false);
  });

  test('masks fine-grained PAT prefix', () => {
    const token = 'github_pat_' + 'b'.repeat(30);
    assert.equal(redact(token).includes(token), false);
  });

  test('masks secret-shaped JSON fields', () => {
    const result = redact('{"token":"abc123","other":"kept"}');
    assert.match(result, /"token":"\[REDACTED\]"/);
    assert.match(result, /"other":"kept"/);
  });

  test('returns empty string for non-string input', () => {
    assert.equal(redact(undefined), '');
    assert.equal(redact(42), '');
  });
});

describe('redactHeaders', () => {
  test('masks only the Authorization header, case-insensitively', () => {
    const result = redactHeaders({ authorization: 'secret-value', 'X-Foo': 'bar' });
    assert.equal(result.authorization, '[REDACTED]');
    assert.equal(result['X-Foo'], 'bar');
  });

  test('handles missing headers gracefully', () => {
    assert.deepEqual(redactHeaders(undefined), {});
  });
});

// ---------------------------------------------------------------------------
// Slug and branch naming
// ---------------------------------------------------------------------------

describe('normalizeSlug', () => {
  test('lowercases and hyphenates', () => {
    assert.equal(normalizeSlug('Fix the Login Button!!'), 'fix-the-login-button');
  });

  test('collapses repeated separators and trims edges', () => {
    assert.equal(normalizeSlug('  --Weird___Title--  '), 'weird-title');
  });

  test('falls back to "task" for empty/unusable input', () => {
    assert.equal(normalizeSlug(''), 'task');
    assert.equal(normalizeSlug('!!!'), 'task');
    assert.equal(normalizeSlug(undefined), 'task');
  });

  test('caps length at 48 characters with no trailing hyphen', () => {
    const long = 'a'.repeat(60);
    const slug = normalizeSlug(long);
    assert.equal(slug.length <= 48, true);
    assert.equal(slug.endsWith('-'), false);
  });

  test('strips diacritics to plain ASCII', () => {
    assert.equal(normalizeSlug('Café déjà vu'), 'cafe-deja-vu');
  });
});

describe('buildBranchName / isCanonicalBranchName', () => {
  test('builds the exact canonical branch name', () => {
    assert.equal(buildBranchName(42, 'Fix Login'), 'ai/issue-42-fix-login');
  });

  test('throws for a non-positive-integer issue number', () => {
    assert.throws(() => buildBranchName(0, 'x'));
    assert.throws(() => buildBranchName(-1, 'x'));
    assert.throws(() => buildBranchName(1.5, 'x'));
  });

  test('recognizes canonical branch names for the given issue only', () => {
    assert.equal(isCanonicalBranchName('ai/issue-42-fix-login', 42), true);
    assert.equal(isCanonicalBranchName('ai/issue-43-fix-login', 42), false);
    assert.equal(isCanonicalBranchName('feature/other', 42), false);
    assert.equal(isCanonicalBranchName(null, 42), false);
  });
});

// ---------------------------------------------------------------------------
// Trigger qualification
// ---------------------------------------------------------------------------

describe('qualifyIssuesEvent', () => {
  test('opened qualifies only with the exact permanent label present', () => {
    assert.equal(
      qualifyIssuesEvent({ action: 'opened', issueLabels: ['ai-development'] }).qualifies,
      true,
    );
    assert.equal(
      qualifyIssuesEvent({ action: 'opened', issueLabels: ['bug'] }).qualifies,
      false,
    );
    assert.equal(qualifyIssuesEvent({ action: 'opened', issueLabels: [] }).qualifies, false);
  });

  test('labeled qualifies only for the exact label name, case-sensitively', () => {
    assert.equal(
      qualifyIssuesEvent({ action: 'labeled', label: { name: 'ai-development' } }).qualifies,
      true,
    );
    assert.equal(
      qualifyIssuesEvent({ action: 'labeled', label: { name: 'AI-Development' } }).qualifies,
      false,
    );
    assert.equal(
      qualifyIssuesEvent({ action: 'labeled', label: { name: 'ai-development-x' } }).qualifies,
      false,
    );
  });

  test('every other action never qualifies', () => {
    for (const action of ['edited', 'closed', 'unlabeled', 'reopened', 'assigned']) {
      assert.equal(qualifyIssuesEvent({ action }).qualifies, false);
    }
  });
});

describe('qualifyResumeEvent', () => {
  test('requires the exact permanent label on re-fetched issue labels', () => {
    assert.equal(qualifyResumeEvent({ issueLabels: ['ai-development'] }).qualifies, true);
    assert.equal(qualifyResumeEvent({ issueLabels: ['bug'] }).qualifies, false);
    assert.equal(qualifyResumeEvent({}).qualifies, false);
  });
});

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

describe('evaluateAuthorization', () => {
  test('authorizes write, maintain, and admin', () => {
    for (const permission of ['write', 'maintain', 'admin']) {
      assert.equal(evaluateAuthorization(permission).authorized, true);
    }
  });

  test('rejects read, triage, none, and unknown values', () => {
    for (const permission of ['read', 'triage', 'none', undefined, null]) {
      assert.equal(evaluateAuthorization(permission).authorized, false);
    }
  });
});

// ---------------------------------------------------------------------------
// Label reconciliation
// ---------------------------------------------------------------------------

describe('computeLabelUpdate', () => {
  test('adds the permanent label and the desired active label when absent', () => {
    const result = computeLabelUpdate([], 'ai-planning');
    assert.deepEqual(result.toAdd.sort(), [PERMANENT_LABEL, 'ai-planning'].sort());
    assert.deepEqual(result.toRemove, []);
    assert.deepEqual(result.resultingLabels.sort(), [PERMANENT_LABEL, 'ai-planning'].sort());
  });

  test('replaces the prior active label and preserves unrelated labels', () => {
    const result = computeLabelUpdate(['bug', PERMANENT_LABEL, 'ai-review', 'priority-1'], 'ai-changes-requested');
    assert.deepEqual(result.toAdd, ['ai-changes-requested']);
    assert.deepEqual(result.toRemove, ['ai-review']);
    assert.deepEqual(
      result.resultingLabels.sort(),
      [PERMANENT_LABEL, 'ai-changes-requested', 'bug', 'priority-1'].sort(),
    );
  });

  test('is a no-op add/remove when already in the desired state', () => {
    const result = computeLabelUpdate([PERMANENT_LABEL, 'ai-review'], 'ai-review');
    assert.deepEqual(result.toAdd, []);
    assert.deepEqual(result.toRemove, []);
  });

  test('throws for a desired label outside the active-label set', () => {
    assert.throws(() => computeLabelUpdate([], 'not-a-real-label'), RangeError);
  });
});

describe('verifyLabelInvariant', () => {
  test('valid when permanent label plus exactly one active label are present', () => {
    const result = verifyLabelInvariant([PERMANENT_LABEL, 'ai-review', 'bug']);
    assert.equal(result.valid, true);
    assert.equal(result.activeLabel, 'ai-review');
  });

  test('invalid when the permanent label is missing', () => {
    assert.equal(verifyLabelInvariant(['ai-review']).valid, false);
  });

  test('invalid when no active label is present', () => {
    assert.equal(verifyLabelInvariant([PERMANENT_LABEL]).reason, 'missing-active-label');
  });

  test('invalid when multiple active labels are present', () => {
    assert.equal(
      verifyLabelInvariant([PERMANENT_LABEL, 'ai-review', 'ai-failed']).reason,
      'multiple-active-labels',
    );
  });
});

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

describe('applyTransition', () => {
  test('walks the full happy-path lifecycle', () => {
    let state = null;
    state = applyTransition(state, 'qualify');
    assert.equal(state, 'ai-planning');
    state = applyTransition(state, 'planApproved');
    assert.equal(state, 'ai-implementation');
    state = applyTransition(state, 'implementationComplete');
    assert.equal(state, 'ai-review');
    state = applyTransition(state, 'approved');
    assert.equal(state, 'ai-documentation');
    state = applyTransition(state, 'documented');
    assert.equal(state, 'ai-complete');
  });

  test('supports the changes-requested remediation loop', () => {
    let state = 'ai-review';
    state = applyTransition(state, 'changesRequested');
    assert.equal(state, 'ai-changes-requested');
    state = applyTransition(state, 'remediationStart');
    assert.equal(state, 'ai-implementation');
  });

  test('every active state can reach ai-failed on error', () => {
    for (const state of ['ai-planning', 'ai-implementation', 'ai-review', 'ai-changes-requested', 'ai-documentation']) {
      assert.equal(applyTransition(state, 'error'), 'ai-failed');
    }
  });

  test('rejects transitions not defined for the current state', () => {
    assert.throws(() => applyTransition('ai-planning', 'approved'), RangeError);
    assert.throws(() => applyTransition('ai-complete', 'error'), RangeError);
    assert.throws(() => applyTransition('ai-failed', 'qualify'), RangeError);
  });
});

describe('computeIterationDecision', () => {
  test('allows another cycle below the cap', () => {
    assert.deepEqual(computeIterationDecision(0, 3), { exhausted: false, nextIteration: 1 });
    assert.deepEqual(computeIterationDecision(2, 3), { exhausted: false, nextIteration: 3 });
  });

  test('is exhausted at or above the cap', () => {
    assert.deepEqual(computeIterationDecision(3, 3), { exhausted: true });
    assert.deepEqual(computeIterationDecision(4, 3), { exhausted: true });
  });

  test('treats a zero cap as immediately exhausted', () => {
    assert.deepEqual(computeIterationDecision(0, 0), { exhausted: true });
  });
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

describe('parseMaxIterations', () => {
  test('defaults to 3 when unset', () => {
    assert.deepEqual(parseMaxIterations(undefined), { valid: true, value: DEFAULT_MAX_ITERATIONS });
    assert.deepEqual(parseMaxIterations(''), { valid: true, value: DEFAULT_MAX_ITERATIONS });
    assert.deepEqual(parseMaxIterations(null), { valid: true, value: DEFAULT_MAX_ITERATIONS });
  });

  test('accepts integers from 0 through the ceiling', () => {
    assert.deepEqual(parseMaxIterations('0'), { valid: true, value: 0 });
    assert.deepEqual(parseMaxIterations(String(MAX_ITERATIONS_CEILING)), {
      valid: true,
      value: MAX_ITERATIONS_CEILING,
    });
    assert.deepEqual(parseMaxIterations(5), { valid: true, value: 5 });
  });

  test('fails closed on non-integer, negative, or out-of-range values', () => {
    assert.equal(parseMaxIterations('abc').valid, false);
    assert.equal(parseMaxIterations('-1').valid, false);
    assert.equal(parseMaxIterations('3.5').valid, false);
    assert.equal(parseMaxIterations(String(MAX_ITERATIONS_CEILING + 1)).valid, false);
  });
});

// ---------------------------------------------------------------------------
// Review verdict parsing
// ---------------------------------------------------------------------------

describe('parseReviewVerdict', () => {
  test('parses an exact APPROVED verdict line', () => {
    const content = '# Review\n\nFindings: none\n\nFinal verdict: APPROVED\n';
    assert.deepEqual(parseReviewVerdict(content), { valid: true, verdict: 'APPROVED' });
  });

  test('parses an exact CHANGES REQUESTED verdict line', () => {
    const content = 'Final verdict: CHANGES REQUESTED';
    assert.deepEqual(parseReviewVerdict(content), { valid: true, verdict: 'CHANGES REQUESTED' });
  });

  test('is case-insensitive about the "final verdict" label text', () => {
    assert.equal(parseReviewVerdict('## Final Verdict: APPROVED').valid, true);
  });

  test('fails closed when no verdict line exists', () => {
    assert.equal(parseReviewVerdict('# Review\n\nLooks fine.').reason, 'no-verdict-line');
  });

  test('fails closed when multiple verdict lines exist', () => {
    const content = 'Final verdict: APPROVED\nFinal verdict: CHANGES REQUESTED';
    assert.equal(parseReviewVerdict(content).reason, 'multiple-verdict-lines');
  });

  test('fails closed when the verdict line is ambiguous or missing a token', () => {
    assert.equal(parseReviewVerdict('Final verdict: APPROVED or CHANGES REQUESTED').reason, 'ambiguous-or-missing-verdict-token');
    assert.equal(parseReviewVerdict('Final verdict: TBD').reason, 'ambiguous-or-missing-verdict-token');
  });

  test('fails closed on missing/non-string content', () => {
    assert.equal(parseReviewVerdict('').reason, 'missing-content');
    assert.equal(parseReviewVerdict(undefined).reason, 'missing-content');
  });
});

// ---------------------------------------------------------------------------
// Documentation diff classification
// ---------------------------------------------------------------------------

describe('isDocumentationPath', () => {
  test('recognizes common documentation paths', () => {
    assert.equal(isDocumentationPath('docs/architecture.md'), true);
    assert.equal(isDocumentationPath('README.md'), true);
    assert.equal(isDocumentationPath('templates/copilot-instructions.md'), true);
    assert.equal(isDocumentationPath('CHANGELOG.md'), true);
    assert.equal(isDocumentationPath('notes.md'), true);
  });

  test('rejects application code paths', () => {
    assert.equal(isDocumentationPath('src/index.js'), false);
    assert.equal(isDocumentationPath('.github/workflows/ai-development.yml'), false);
  });
});

describe('classifyDocumentationDiff', () => {
  test('classifies an empty diff as NO CHANGE', () => {
    assert.deepEqual(classifyDocumentationDiff([]), { valid: true, outcome: 'NO CHANGE' });
  });

  test('classifies all-added documentation files as CREATE', () => {
    const diff = [{ path: 'docs/new.md', status: 'added' }];
    assert.deepEqual(classifyDocumentationDiff(diff), { valid: true, outcome: 'CREATE' });
  });

  test('classifies any modified/removed/renamed documentation file as UPDATE', () => {
    assert.equal(
      classifyDocumentationDiff([{ path: 'docs/a.md', status: 'modified' }]).outcome,
      'UPDATE',
    );
    assert.equal(
      classifyDocumentationDiff([
        { path: 'docs/a.md', status: 'added' },
        { path: 'docs/b.md', status: 'modified' },
      ]).outcome,
      'UPDATE',
    );
  });

  test('fails closed when a non-documentation path changed', () => {
    const result = classifyDocumentationDiff([{ path: 'src/app.js', status: 'modified' }]);
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'non-documentation-change');
  });

  test('fails closed on missing file-changes input', () => {
    assert.equal(classifyDocumentationDiff(undefined).reason, 'missing-file-changes');
  });
});

// ---------------------------------------------------------------------------
// Durable state comment
// ---------------------------------------------------------------------------

describe('state comment round trip', () => {
  test('serializes and parses back an equivalent state', () => {
    const state = {
      issueNumber: 7,
      branch: 'ai/issue-7-fix',
      prNumber: 12,
      phase: 'ai-review',
      taskId: 'task-1',
      headSha: 'abc123',
      reviewIteration: 1,
      maxIterations: 3,
    };
    const body = buildStateComment(state);
    assert.equal(isControllerStateComment(body), true);
    assert.deepEqual(parseStateComment(body), { schemaVersion: 1, ...state });
  });

  test('rejects comments without the marker or with unparsable/mismatched schema data', () => {
    assert.equal(parseStateComment('hello world'), null);
    assert.equal(isControllerStateComment('hello world'), false);
    assert.equal(
      parseStateComment('<!-- ai-development-controller:data:{"schemaVersion":99} -->'),
      null,
    );
    assert.equal(parseStateComment(undefined), null);
  });
});

// ---------------------------------------------------------------------------
// Terminal comments
// ---------------------------------------------------------------------------

describe('terminal comments', () => {
  test('builds an idempotent completion comment carrying its own marker', () => {
    const body = buildTerminalComment({
      result: 'ai-complete',
      issueNumber: 7,
      branch: 'ai/issue-7-fix',
      prNumber: 12,
      summary: 'Documentation outcome: CREATE.',
    });
    assert.equal(isTerminalComment(body, 'ai-complete', 7), true);
    assert.equal(isTerminalComment(body, 'ai-failed', 7), false);
    assert.match(body, /does not merge automatically/);
  });

  test('builds a failure comment that never claims success', () => {
    const body = buildTerminalComment({
      result: 'ai-failed',
      issueNumber: 9,
      summary: 'Stopped early.',
      reason: 'review iteration cap exhausted',
    });
    assert.equal(isTerminalComment(body, 'ai-failed', 9), true);
    assert.match(body, /maintainer must review/);
  });

  test('redacts secret-shaped values embedded in comment fields', () => {
    const secretToken = 'ghp_' + 'c'.repeat(36);
    const body = buildTerminalComment({
      result: 'ai-failed',
      issueNumber: 1,
      summary: 'failure',
      reason: `upstream error included ${secretToken}`,
    });
    assert.equal(body.includes(secretToken), false);
  });

  test('rejects a result outside the two terminal outcomes', () => {
    assert.throws(() => buildTerminalComment({ result: 'ai-review', issueNumber: 1, summary: 'x' }));
  });

  test('marker distinguishes issue numbers and results', () => {
    assert.notEqual(buildTerminalCommentMarker('ai-complete', 1), buildTerminalCommentMarker('ai-complete', 2));
    assert.notEqual(buildTerminalCommentMarker('ai-complete', 1), buildTerminalCommentMarker('ai-failed', 1));
  });
});

// ---------------------------------------------------------------------------
// Agent Tasks state evaluation
// ---------------------------------------------------------------------------

describe('evaluateTaskState', () => {
  test('queued/in_progress are pending', () => {
    assert.equal(evaluateTaskState('queued').outcome, 'pending');
    assert.equal(evaluateTaskState('in_progress').outcome, 'pending');
  });

  test('completed is completed', () => {
    assert.equal(evaluateTaskState('completed').outcome, 'completed');
  });

  test('failed/idle/waiting_for_user/timed_out/cancelled all fail closed', () => {
    for (const state of ['failed', 'idle', 'waiting_for_user', 'timed_out', 'cancelled']) {
      assert.equal(evaluateTaskState(state).outcome, 'failed');
    }
  });

  test('unknown states fail closed', () => {
    const result = evaluateTaskState('some_future_state');
    assert.equal(result.outcome, 'failed');
    assert.match(result.reason, /unknown-task-state/);
  });

  test('every documented state is handled without throwing', () => {
    for (const state of KNOWN_TASK_STATES) {
      assert.doesNotThrow(() => evaluateTaskState(state));
    }
  });
});

describe('computeBackoffDelayMs', () => {
  test('grows exponentially and is bounded by maxMs', () => {
    assert.equal(computeBackoffDelayMs(0, { baseMs: 1000, maxMs: 30000 }), 1000);
    assert.equal(computeBackoffDelayMs(1, { baseMs: 1000, maxMs: 30000 }), 2000);
    assert.equal(computeBackoffDelayMs(10, { baseMs: 1000, maxMs: 30000 }), 30000);
  });
});

describe('extractTaskPullArtifact', () => {
  test('extracts the pull number when the artifact matches the expected head ref', () => {
    const artifacts = [
      { provider: 'github', type: 'branch', data: { head_ref: 'ai/issue-1-x', base_ref: 'main' } },
      { provider: 'github', type: 'pull', data: { id: 55 } },
    ];
    assert.deepEqual(extractTaskPullArtifact(artifacts, 'ai/issue-1-x'), { valid: true, prNumber: 55 });
  });

  test('fails closed when the pull artifact is missing', () => {
    assert.equal(extractTaskPullArtifact([], 'ai/issue-1-x').reason, 'missing-pull-artifact');
  });

  test('fails closed when the head ref does not match', () => {
    const artifacts = [
      { provider: 'github', type: 'branch', data: { head_ref: 'copilot/other-branch' } },
      { provider: 'github', type: 'pull', data: { id: 55 } },
    ];
    assert.equal(extractTaskPullArtifact(artifacts, 'ai/issue-1-x').reason, 'head-ref-mismatch');
  });
});

// ---------------------------------------------------------------------------
// Agent prompt construction
// ---------------------------------------------------------------------------

describe('buildAgentPrompt', () => {
  test('maps every plan-defined phase to its existing specialist agent', () => {
    for (const phase of Object.keys(AGENT_FOR_PHASE)) {
      const prompt = buildAgentPrompt(phase, { issueNumber: 1, branch: 'ai/issue-1-x', reviewIteration: 1 });
      assert.equal(typeof prompt, 'string');
      assert.match(prompt, /#1/);
      assert.match(prompt, /ai\/issue-1-x/);
    }
  });

  test('never embeds raw issue title/body text', () => {
    const prompt = buildAgentPrompt('ai-planning', {
      issueNumber: 1,
      branch: 'ai/issue-1-x',
      reviewIteration: 0,
    });
    assert.doesNotMatch(prompt, /<script>/);
  });

  test('throws for a phase with no mapped agent', () => {
    assert.throws(() => buildAgentPrompt('ai-complete', { issueNumber: 1, branch: 'b', reviewIteration: 0 }));
  });
});

// ---------------------------------------------------------------------------
// Network layer (mocked fetch boundary; no real network access)
// ---------------------------------------------------------------------------

describe('GitHubClient', () => {
  test('sends bounded, typed requests and never logs the raw token', async () => {
    let capturedHeaders;
    const fetchImpl = async (url, opts) => {
      capturedHeaders = opts.headers;
      assert.equal(url, 'https://api.github.com/repos/o/r/issues/1');
      return { ok: true, status: 200, text: async () => JSON.stringify({ number: 1 }) };
    };
    const client = new GitHubClient({ token: 'test-token-value', fetchImpl });
    const issue = await client.getIssue('o', 'r', 1);
    assert.deepEqual(issue, { number: 1 });
    assert.equal(capturedHeaders.Authorization.includes('test-token-value'), true);
    assert.equal(redactHeaders(capturedHeaders).Authorization, '[REDACTED]');
  });

  test('rejects and redacts bearer-shaped secrets on non-2xx responses instead of inferring success', async () => {
    const leakedSecret = ['Bearer', 'super-secret-value-1234567890'].join(' ');
    const fetchImpl = async () => ({
      ok: false,
      status: 401,
      text: async () => `Bad credentials: ${leakedSecret}`,
    });
    const client = new GitHubClient({ token: 'x', fetchImpl });
    await assert.rejects(
      () => client.getIssue('o', 'r', 1),
      (error) => {
        assert.match(error.message, /401/);
        assert.equal(error.message.includes('super-secret-value-1234567890'), false);
        return true;
      },
    );
  });

  test('throws when constructed without a token', () => {
    assert.throws(() => new GitHubClient({ token: '' }));
  });
});

describe('AgentTasksClient', () => {
  test('starts a task against the documented endpoint shape', async () => {
    let capturedBody;
    const fetchImpl = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      assert.equal(url, 'https://api.github.com/agents/repos/o/r/tasks');
      return { ok: true, status: 201, text: async () => JSON.stringify({ id: 't1', state: 'queued' }) };
    };
    const client = new AgentTasksClient({ token: 'x', fetchImpl });
    const task = await client.startTask('o', 'r', {
      prompt: 'do the thing',
      customAgent: 'planning-agent',
      baseRef: 'main',
      headRef: 'ai/issue-1-x',
    });
    assert.equal(task.id, 't1');
    assert.equal(capturedBody.custom_agent, 'planning-agent');
    assert.equal(capturedBody.base_ref, 'main');
    assert.equal(capturedBody.head_ref, 'ai/issue-1-x');
  });

  test('throws when constructed without a token', () => {
    assert.throws(() => new AgentTasksClient({ token: undefined }));
  });
});

// ---------------------------------------------------------------------------
// Orchestration (runController) against mocked GitHub/Agent Tasks clients.
//
// NOTE: these tests validate the controller's own logic (label/state
// invariants, artifact validation, iteration cap, terminal comments) against
// fully mocked API boundaries. They do not and cannot exercise the live
// GitHub REST API or the public-preview Agent Tasks API: no such credential
// or disposable integration repository is available in this environment.
// ---------------------------------------------------------------------------

function makeMockGithub(overrides = {}) {
  const state = {
    labels: [PERMANENT_LABEL],
    comments: [],
    nextCommentId: 1,
    prs: {},
    nextPrNumber: 100,
    refs: { 'heads/main': { object: { sha: 'base-sha' } } },
    commits: { 'base-sha': { tree: { sha: 'tree-sha' }, sha: 'base-sha' } },
    defaultBranch: 'main',
    files: {},
    compareResults: {},
    ...overrides,
  };

  const client = {
    _state: state,
    async getIssue() {
      return { number: 7, title: 'Fix login bug', labels: state.labels.map((name) => ({ name })) };
    },
    async replaceLabels(owner, repo, issueNumber, labels) {
      state.labels = labels;
      return labels;
    },
    async createLabelIfMissing() {
      return undefined;
    },
    async getRef(owner, repo, ref) {
      if (!state.refs[ref]) {
        throw new Error('404 Not Found');
      }
      return state.refs[ref];
    },
    async getCommit(owner, repo, sha) {
      return state.commits[sha];
    },
    async createCommit(owner, repo, { tree, parents }) {
      const sha = `commit-${Object.keys(state.commits).length}`;
      state.commits[sha] = { tree: { sha: tree }, sha, parents };
      return { sha };
    },
    async createRef(owner, repo, ref, sha) {
      state.refs[ref] = { object: { sha } };
      return {};
    },
    async findPullByHead() {
      return [];
    },
    async createPullRequest(owner, repo, params) {
      const number = state.nextPrNumber++;
      const pr = { number, head: { sha: state.refs[`heads/${params.head}`].object.sha }, base: params.base };
      state.prs[number] = pr;
      return pr;
    },
    async getRepository() {
      return { default_branch: state.defaultBranch };
    },
    async getPullRequest(owner, repo, number) {
      return state.prs[number];
    },
    async compareCommits(owner, repo, base, head) {
      return { files: state.compareResults[`${base}...${head}`] ?? [] };
    },
    async listIssueComments() {
      return state.comments;
    },
    async createIssueComment(owner, repo, issueNumber, body) {
      const comment = { id: state.nextCommentId++, body };
      state.comments.push(comment);
      return comment;
    },
    async updateIssueComment(owner, repo, commentId, body) {
      const comment = state.comments.find((candidate) => candidate.id === commentId);
      comment.body = body;
      return comment;
    },
    async getPullFileContent(owner, repo, path) {
      return { encoding: 'utf-8', content: state.files[path] };
    },
  };

  return client;
}

function makeMockAgentTasks() {
  const startedTasks = [];
  let callIndex = 0;
  return {
    startedTasks,
    async startTask(owner, repo, params) {
      const id = `task-${callIndex}`;
      callIndex += 1;
      startedTasks.push({ id, ...params });
      return { id };
    },
    async getTask(owner, repo, taskId) {
      return {
        id: taskId,
        state: 'completed',
        artifacts: [{ provider: 'github', type: 'pull', data: { id: 100 } }],
      };
    },
  };
}

describe('runController', () => {
  test('drives the full happy path from qualifying trigger to ai-complete', async () => {
    const github = makeMockGithub();
    const shaSequence = ['head-plan', 'head-impl', 'head-review', 'head-doc'];
    let shaIndex = 0;
    github.getPullRequest = async (owner, repo, number) => ({
      number,
      head: { sha: shaSequence[Math.min(shaIndex++, shaSequence.length - 1)] },
    });
    github._state.compareResults['main...head-plan'] = [
      { filename: '.github/plans/20260823-fix.plan.md', status: 'added' },
    ];
    github._state.compareResults['head-plan...head-impl'] = [];
    github._state.compareResults['head-impl...head-review'] = [
      { filename: '.github/reviews/20260823-fix.review.md', status: 'added' },
    ];
    github._state.files['.github/reviews/20260823-fix.review.md'] = 'Final verdict: APPROVED\n';
    github._state.compareResults['head-review...head-doc'] = [{ filename: 'docs/x.md', status: 'added' }];

    const agentTasks = makeMockAgentTasks();

    const result = await runController({
      github,
      agentTasks,
      owner: 'o',
      repo: 'r',
      issueNumber: 7,
      maxIterations: 3,
      sleepImpl: async () => {},
    });

    assert.equal(result.finalLabel, 'ai-complete');
    assert.deepEqual(github._state.labels, [PERMANENT_LABEL, 'ai-complete']);
    assert.equal(
      agentTasks.startedTasks.map((task) => task.customAgent).join(','),
      'planning-agent,implementation-agent,code-review-agent,documentation-agent',
    );
    const terminalComment = github._state.comments.find((comment) =>
      isTerminalComment(comment.body, 'ai-complete', 7),
    );
    assert.ok(terminalComment, 'expected an idempotent completion comment');
    assert.match(terminalComment.body, /CREATE/);
  });

  test('loops through one CHANGES REQUESTED remediation cycle before APPROVED', async () => {
    const github = makeMockGithub();
    const shaSequence = ['head-plan', 'head-impl1', 'head-review1', 'head-impl2', 'head-review2', 'head-doc'];
    let shaIndex = 0;
    github.getPullRequest = async (owner, repo, number) => ({
      number,
      head: { sha: shaSequence[Math.min(shaIndex++, shaSequence.length - 1)] },
    });
    github._state.compareResults['main...head-plan'] = [{ filename: '.github/plans/x.plan.md', status: 'added' }];
    github._state.compareResults['head-plan...head-impl1'] = [];
    github._state.compareResults['head-impl1...head-review1'] = [
      { filename: '.github/reviews/r1.review.md', status: 'added' },
    ];
    github._state.files['.github/reviews/r1.review.md'] = 'Final verdict: CHANGES REQUESTED\n';
    github._state.compareResults['head-review1...head-impl2'] = [];
    github._state.compareResults['head-impl2...head-review2'] = [
      { filename: '.github/reviews/r2.review.md', status: 'added' },
    ];
    github._state.files['.github/reviews/r2.review.md'] = 'Final verdict: APPROVED\n';
    github._state.compareResults['head-review2...head-doc'] = [];

    const agentTasks = makeMockAgentTasks();
    const result = await runController({
      github,
      agentTasks,
      owner: 'o',
      repo: 'r',
      issueNumber: 7,
      maxIterations: 3,
      sleepImpl: async () => {},
    });

    assert.equal(result.finalLabel, 'ai-complete');
    assert.equal(
      agentTasks.startedTasks.map((task) => task.customAgent).join(','),
      'planning-agent,implementation-agent,code-review-agent,implementation-agent,code-review-agent,documentation-agent',
    );
  });

  test('fails closed once the configured iteration cap is exhausted', async () => {
    const github = makeMockGithub();
    const shaSequence = ['head-plan', 'head-impl1', 'head-review1'];
    let shaIndex = 0;
    github.getPullRequest = async (owner, repo, number) => ({
      number,
      head: { sha: shaSequence[Math.min(shaIndex++, shaSequence.length - 1)] },
    });
    github._state.compareResults['main...head-plan'] = [{ filename: '.github/plans/x.plan.md', status: 'added' }];
    github._state.compareResults['head-plan...head-impl1'] = [];
    github._state.compareResults['head-impl1...head-review1'] = [
      { filename: '.github/reviews/r1.review.md', status: 'added' },
    ];
    github._state.files['.github/reviews/r1.review.md'] = 'Final verdict: CHANGES REQUESTED\n';

    const agentTasks = makeMockAgentTasks();
    await assert.rejects(
      () =>
        runController({
          github,
          agentTasks,
          owner: 'o',
          repo: 'r',
          issueNumber: 7,
          maxIterations: 0,
          sleepImpl: async () => {},
        }),
      ControllerError,
    );
  });

  test('fails closed on an unknown/undocumented Agent Tasks state', async () => {
    const github = makeMockGithub();
    const agentTasks = {
      async startTask() {
        return { id: 't1' };
      },
      async getTask() {
        return { id: 't1', state: 'some_future_state', artifacts: [] };
      },
    };

    await assert.rejects(
      () =>
        runController({
          github,
          agentTasks,
          owner: 'o',
          repo: 'r',
          issueNumber: 7,
          maxIterations: 3,
          sleepImpl: async () => {},
        }),
      ControllerError,
    );
  });

  test('fails closed when the planning task produces no plan artifact', async () => {
    const github = makeMockGithub();
    github.getPullRequest = async (owner, repo, number) => ({ number, head: { sha: 'head-plan' } });
    github._state.compareResults['main...head-plan'] = [];
    const agentTasks = makeMockAgentTasks();

    await assert.rejects(
      () =>
        runController({
          github,
          agentTasks,
          owner: 'o',
          repo: 'r',
          issueNumber: 7,
          maxIterations: 3,
          sleepImpl: async () => {},
        }),
      ControllerError,
    );
  });

  test('fails closed when the review task adds zero or multiple review artifacts', async () => {
    const github = makeMockGithub();
    const shaSequence = ['head-plan', 'head-impl', 'head-review'];
    let shaIndex = 0;
    github.getPullRequest = async (owner, repo, number) => ({
      number,
      head: { sha: shaSequence[Math.min(shaIndex++, shaSequence.length - 1)] },
    });
    github._state.compareResults['main...head-plan'] = [{ filename: '.github/plans/x.plan.md', status: 'added' }];
    github._state.compareResults['head-plan...head-impl'] = [];
    github._state.compareResults['head-impl...head-review'] = [];

    const agentTasks = makeMockAgentTasks();
    await assert.rejects(
      () =>
        runController({
          github,
          agentTasks,
          owner: 'o',
          repo: 'r',
          issueNumber: 7,
          maxIterations: 3,
          sleepImpl: async () => {},
        }),
      ControllerError,
    );
  });

  test('fails closed when the documentation task touches a non-documentation path', async () => {
    const github = makeMockGithub();
    const shaSequence = ['head-plan', 'head-impl', 'head-review', 'head-doc'];
    let shaIndex = 0;
    github.getPullRequest = async (owner, repo, number) => ({
      number,
      head: { sha: shaSequence[Math.min(shaIndex++, shaSequence.length - 1)] },
    });
    github._state.compareResults['main...head-plan'] = [{ filename: '.github/plans/x.plan.md', status: 'added' }];
    github._state.compareResults['head-plan...head-impl'] = [];
    github._state.compareResults['head-impl...head-review'] = [
      { filename: '.github/reviews/r.review.md', status: 'added' },
    ];
    github._state.files['.github/reviews/r.review.md'] = 'Final verdict: APPROVED\n';
    github._state.compareResults['head-review...head-doc'] = [{ filename: 'src/app.js', status: 'modified' }];

    const agentTasks = makeMockAgentTasks();
    await assert.rejects(
      () =>
        runController({
          github,
          agentTasks,
          owner: 'o',
          repo: 'r',
          issueNumber: 7,
          maxIterations: 3,
          sleepImpl: async () => {},
        }),
      ControllerError,
    );
  });

  test('no-ops when the issue already carries a terminal label', async () => {
    const github = makeMockGithub({ labels: [PERMANENT_LABEL, 'ai-complete'] });
    const agentTasks = makeMockAgentTasks();

    const result = await runController({
      github,
      agentTasks,
      owner: 'o',
      repo: 'r',
      issueNumber: 7,
      maxIterations: 3,
    });

    assert.deepEqual(result, { noop: true, reason: 'already-terminal', activeLabel: 'ai-complete' });
    assert.equal(agentTasks.startedTasks.length, 0);
  });

  test('surfaces a label invariant violation rather than silently continuing', async () => {
    const github = makeMockGithub();
    // Simulate a concurrent external label edit racing the controller by
    // making replaceLabels leave an extra active label behind.
    github.replaceLabels = async (owner, repo, issueNumber, labels) => {
      github._state.labels = [...labels, 'ai-review'];
      return github._state.labels;
    };
    const agentTasks = makeMockAgentTasks();

    await assert.rejects(
      () =>
        runController({
          github,
          agentTasks,
          owner: 'o',
          repo: 'r',
          issueNumber: 7,
          maxIterations: 3,
          sleepImpl: async () => {},
        }),
      ControllerError,
    );
  });
});

// ---------------------------------------------------------------------------
// Watchdog
// ---------------------------------------------------------------------------

describe('parseIssueNumberFromRunName', () => {
  test('extracts the issue number from the controller run-name convention', () => {
    assert.equal(parseIssueNumberFromRunName('AI development: issue #42'), 42);
  });

  test('returns undefined for unrecognized or missing run names', () => {
    assert.equal(parseIssueNumberFromRunName('Some other workflow'), undefined);
    assert.equal(parseIssueNumberFromRunName(undefined), undefined);
    assert.equal(parseIssueNumberFromRunName(123), undefined);
  });
});

describe('runWatchdog', () => {
  test('no-ops when the controller run already succeeded', async () => {
    const github = makeMockGithub();
    const result = await runWatchdog({
      github,
      owner: 'o',
      repo: 'r',
      issueNumber: 7,
      conclusion: 'success',
    });
    assert.deepEqual(result, { noop: true, reason: 'run-succeeded' });
  });

  test('no-ops when the issue is already terminal', async () => {
    const github = makeMockGithub({ labels: [PERMANENT_LABEL, 'ai-complete'] });
    const result = await runWatchdog({
      github,
      owner: 'o',
      repo: 'r',
      issueNumber: 7,
      conclusion: 'cancelled',
    });
    assert.deepEqual(result, { noop: true, reason: 'already-terminal', activeLabel: 'ai-complete' });
  });

  test('sets ai-failed and posts one idempotent comment for a cancelled/timed-out run left non-terminal', async () => {
    const github = makeMockGithub({ labels: [PERMANENT_LABEL, 'ai-implementation'] });
    const result = await runWatchdog({
      github,
      owner: 'o',
      repo: 'r',
      issueNumber: 7,
      conclusion: 'cancelled',
      runUrl: 'https://github.com/o/r/actions/runs/1',
    });
    assert.deepEqual(result, { handled: true, activeLabel: 'ai-failed' });
    assert.deepEqual(github._state.labels, [PERMANENT_LABEL, 'ai-failed']);
    assert.equal(github._state.comments.length, 1);
    assert.equal(isTerminalComment(github._state.comments[0].body, 'ai-failed', 7), true);
  });

  test('does not duplicate the failure comment when invoked again for the same issue', async () => {
    const github = makeMockGithub({ labels: [PERMANENT_LABEL, 'ai-review'] });
    await runWatchdog({ github, owner: 'o', repo: 'r', issueNumber: 7, conclusion: 'timed_out' });
    await runWatchdog({ github, owner: 'o', repo: 'r', issueNumber: 7, conclusion: 'timed_out' });
    const failureComments = github._state.comments.filter((comment) =>
      isTerminalComment(comment.body, 'ai-failed', 7),
    );
    assert.equal(failureComments.length, 1);
  });

  test('never reads pull-request file content', async () => {
    const github = makeMockGithub({ labels: [PERMANENT_LABEL, 'ai-planning'] });
    github.getPullFileContent = () => {
      throw new Error('watchdog must never read PR file content');
    };
    github.listPullFiles = () => {
      throw new Error('watchdog must never list PR files');
    };
    await runWatchdog({ github, owner: 'o', repo: 'r', issueNumber: 7, conclusion: 'failure' });
  });
});

