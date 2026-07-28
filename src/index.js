const crypto = require('crypto');

const COMMENT_MARKER = '<!-- publishloud-ship-note -->';

function getInput(name, options = {}) {
  // GitHub exposes inputs as INPUT_* with spaces/hyphens → underscores.
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
    return ['opened', 'ready_for_review', 'merged', 'workflow_dispatch'].includes(
      eventName,
    );
  }
  return eventName === 'merged';
}

function base64url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function normalizePrivateKey(pem) {
  let key = String(pem || '').trim();
  if (!key) return '';
  // Secrets often store literal \n
  key = key.replace(/\\n/g, '\n');
  if (!key.includes('BEGIN')) {
    throw new Error('github-app-private-key must be a PEM private key');
  }
  return key;
}

/**
 * Mint a short-lived GitHub App JWT (RS256).
 * @param {string} appId
 * @param {string} privateKeyPem
 */
function createAppJwt(appId, privateKeyPem) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iat: now - 60,
      exp: now + 9 * 60,
      iss: String(appId),
    }),
  );
  const data = `${header}.${payload}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(data);
  signer.end();
  const signature = signer
    .sign(normalizePrivateKey(privateKeyPem), 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${data}.${signature}`;
}

async function githubRequest(method, urlPath, token, body, authScheme = 'Bearer') {
  const res = await fetch(`https://api.github.com${urlPath}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `${authScheme} ${token}`,
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

/**
 * Resolve an installation access token so comments post as the PublishLoud GitHub App
 * (custom name + logo), like CodeRabbit — not github-actions.
 */
async function getInstallationToken({ appId, privateKey, installationId, owner, repo }) {
  const jwt = createAppJwt(appId, privateKey);
  let installId = String(installationId || '').trim();
  if (!installId) {
    const installation = await githubRequest(
      'GET',
      `/repos/${owner}/${repo}/installation`,
      jwt,
    );
    installId = String(installation.id || '');
  }
  if (!installId) {
    throw new Error(
      'Could not resolve GitHub App installation for this repo. Install the PublishLoud app on the repository.',
    );
  }
  const tokenRes = await githubRequest(
    'POST',
    `/app/installations/${installId}/access_tokens`,
    jwt,
    {},
  );
  if (!tokenRes.token) {
    throw new Error('GitHub App installation token response missing token');
  }
  info(`Using PublishLoud GitHub App installation ${installId} for PR comments`);
  return tokenRes.token;
}

async function resolveGitHubToken({ owner, repo }) {
  const appId = getInput('github-app-id') || process.env.PUBLISHLOUD_GITHUB_APP_ID || '';
  const privateKey =
    getInput('github-app-private-key') ||
    process.env.PUBLISHLOUD_GITHUB_APP_PRIVATE_KEY ||
    '';
  const installationId =
    getInput('github-app-installation-id') ||
    process.env.PUBLISHLOUD_GITHUB_APP_INSTALLATION_ID ||
    '';

  if (appId && privateKey) {
    return getInstallationToken({
      appId,
      privateKey,
      installationId,
      owner,
      repo,
    });
  }

  const token =
    getInput('github-token') ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    '';
  if (!token) {
    throw new Error(
      'Pass github-app-id + github-app-private-key (recommended, custom bot identity) or github-token: ${{ github.token }}.',
    );
  }
  info(
    'Using github.token (comments appear as github-actions). Add a PublishLoud GitHub App for branded identity.',
  );
  return token;
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

  const token = await resolveGitHubToken({ owner, repo });

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
