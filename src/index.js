const COMMENT_MARKER = '<!-- publishloud-ship-note -->';

function getInput(name, options = {}) {
  // GitHub exposes inputs as INPUT_* with spaces/hyphens → underscores.
  // Try both forms so api-key / on-mode / github-token always resolve.
  const upper = String(name || '').toUpperCase();
  const candidates = [
    `INPUT_${upper.replace(/ /g, '_')}`,
    `INPUT_${upper.replace(/ /g, '_').replace(/-/g, '_')}`,
  ];
  let val = '';
  for (const key of candidates) {
    const raw = process.env[key];
    if (raw != null && String(raw).trim() !== '') {
      val = String(raw).trim();
      break;
    }
  }
  if (!val && options.required) {
    throw new Error(`Input required and not supplied: ${name}`);
  }
  return val || options.default || '';
}

function setFailed(message) {
  console.error(message);
  process.exitCode = 1;
}

function info(message) {
  console.log(message);
}

function shouldSkipActor(actor) {
  const a = String(actor || '').toLowerCase();
  return (
    a.endsWith('[bot]') ||
    a === 'dependabot[bot]' ||
    a === 'dependabot-preview[bot]' ||
    a === 'github-actions[bot]' ||
    a === 'renovate[bot]'
  );
}

function parseEvent() {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path) throw new Error('GITHUB_EVENT_PATH is not set');
  // eslint-disable-next-line import/no-dynamic-require, global-require
  return require(path);
}

function resolveEventName(payload) {
  const action = payload.action;
  if (action === 'closed' && payload.pull_request?.merged) return 'merged';
  if (action === 'ready_for_review') return 'ready_for_review';
  if (action === 'opened' || action === 'reopened' || action === 'synchronize') {
    return 'opened';
  }
  if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    return 'workflow_dispatch';
  }
  return String(action || 'opened');
}

function shouldRunForMode(onMode, eventName, payload) {
  const mode = (onMode || 'merged').toLowerCase();
  const action = payload?.action;
  if (eventName === 'workflow_dispatch') return true;
  if (action === 'closed' && !payload.pull_request?.merged) {
    return false;
  }
  if (mode === 'opened') {
    // opened / reopened / synchronize all resolve to eventName "opened"
    return ['opened', 'ready_for_review', 'merged', 'workflow_dispatch'].includes(
      eventName,
    );
  }
  // merged: comment on merge only
  return eventName === 'merged';
}

async function githubRequest(method, urlPath, token, body) {
  const res = await fetch(`https://api.github.com${urlPath}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'publishloud-pr-ship-note',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }
  if (!res.ok) {
    const err = new Error(data.message || `GitHub API ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function findExistingComment(token, owner, repo, issueNumber) {
  const comments = await githubRequest(
    'GET',
    `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`,
    token,
  );
  if (!Array.isArray(comments)) return null;
  return (
    comments.find((c) => String(c.body || '').includes(COMMENT_MARKER)) || null
  );
}

async function upsertComment(token, owner, repo, issueNumber, body) {
  const existing = await findExistingComment(token, owner, repo, issueNumber);
  if (existing) {
    await githubRequest(
      'PATCH',
      `/repos/${owner}/${repo}/issues/comments/${existing.id}`,
      token,
      { body },
    );
    info(`Updated PublishLoud comment ${existing.id}`);
    return;
  }
  await githubRequest(
    'POST',
    `/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    token,
    { body },
  );
  info('Created PublishLoud ship-note comment');
}

async function postShipNote(apiBase, apiKey, payload) {
  const res = await fetch(`${apiBase.replace(/\/$/, '')}/publishloud/v1/ship-notes`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!res.ok) {
    const err = new Error(data.error || `PublishLoud API ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data.data || data;
}

async function main() {
  const apiKey = getInput('api-key', { required: true });
  const apiBase = getInput('api-base-url', {
    default: 'https://api.baloon.dev',
  });
  const onMode = getInput('on-mode', { default: 'merged' });
  const token =
    getInput('github-token') ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    '';
  if (!token) {
    throw new Error(
      'GITHUB_TOKEN is required (permissions: pull-requests: write). Pass github-token: ${{ github.token }}.',
    );
  }

  const payload = parseEvent();
  const pr = payload.pull_request;
  if (!pr) {
    info('No pull_request in event; skipping');
    return;
  }

  const actor = payload.sender?.login || process.env.GITHUB_ACTOR;
  if (shouldSkipActor(actor)) {
    info(`Skipping bot actor: ${actor}`);
    return;
  }

  const eventName = resolveEventName(payload);
  if (!shouldRunForMode(onMode, eventName, payload)) {
    info(
      `Skipping for on-mode=${onMode} event=${eventName} action=${payload.action || ''}`,
    );
    return;
  }

  const labels = (pr.labels || []).map((l) => l.name || l);
  if (labels.map((l) => String(l).toLowerCase()).includes('publishloud-skip')) {
    info('Skipping: publishloud-skip label');
    return;
  }

  if (pr.draft && eventName !== 'ready_for_review' && eventName !== 'merged') {
    info('Skipping draft PR');
    return;
  }

  const [owner, repo] = String(process.env.GITHUB_REPOSITORY || '').split('/');
  if (!owner || !repo) {
    throw new Error('GITHUB_REPOSITORY is not set');
  }

  const commitMessages = [];
  try {
    const commits = await githubRequest(
      'GET',
      `/repos/${owner}/${repo}/pulls/${pr.number}/commits?per_page=30`,
      token,
    );
    if (Array.isArray(commits)) {
      for (const c of commits) {
        if (c.commit?.message) commitMessages.push(c.commit.message.split('\n')[0]);
      }
    }
  } catch (err) {
    info(`Could not load commits: ${err.message}`);
  }

  const changedFiles = [];
  try {
    const files = await githubRequest(
      'GET',
      `/repos/${owner}/${repo}/pulls/${pr.number}/files?per_page=80`,
      token,
      null,
    );
    if (Array.isArray(files)) {
      for (const f of files) {
        if (f.filename) changedFiles.push(f.filename);
      }
    }
  } catch (err) {
    info(`Could not load files: ${err.message}`);
  }

  const runId = process.env.GITHUB_RUN_ID || '';
  const runUrl =
    runId && process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${runId}`
      : '';

  const result = await postShipNote(apiBase, apiKey, {
    event: eventName,
    repo: {
      owner,
      name: repo,
      htmlUrl: payload.repository?.html_url || `https://github.com/${owner}/${repo}`,
    },
    pullRequest: {
      number: pr.number,
      title: pr.title || '',
      body: pr.body || '',
      htmlUrl: pr.html_url || '',
      merged: Boolean(pr.merged),
      base: pr.base?.ref || '',
      head: pr.head?.ref || '',
      labels,
      changedFiles,
      commitMessages,
      draft: Boolean(pr.draft),
    },
    github: { runId, runUrl },
  });

  if (result.mode === 'skipped' || !result.commentMarkdown) {
    info(`Ship note skipped: ${result.reason || 'no comment'}`);
    return;
  }

  await upsertComment(token, owner, repo, pr.number, result.commentMarkdown);
  info(`Ship note mode=${result.mode}`);
}

main().catch((err) => {
  setFailed(err.message || String(err));
});
