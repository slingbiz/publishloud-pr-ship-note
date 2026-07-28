# PublishLoud GitHub App (branded PR comments)

Without a GitHub App, comments post as **github-actions** (generic Octocat).  
With a PublishLoud GitHub App, comments post as **PublishLoud** with your logo — same pattern as CodeRabbit.

## 1. Create the app (as slingbiz)

1. Open https://github.com/settings/apps/new (user) or org Developer settings → GitHub Apps → New.
2. **GitHub App name:** `PublishLoud` (must be unique on GitHub).
3. **Homepage URL:** `https://www.publishloud.com`
4. **Webhook:** uncheck Active (not needed for comments).
5. **Repository permissions:**
   - Contents: Read-only
   - Issues: Read and write
   - Pull requests: Read and write
   - Metadata: Read-only
6. **Where can this GitHub App be installed?** Only on this account (or any account if you want public installs later).
7. Create the app.
8. **Upload logo** (PublishLoud icon) on the app settings page — this becomes the comment avatar.
9. Note **App ID**.
10. **Generate a private key** → download the `.pem` file.

## 2. Install on the repo

App settings → **Install App** → choose `slingbiz` → select `publishloud`, `sling-ai`, etc. → Install.

## 3. Add repo secrets

On each repo (or org secrets):

| Secret | Value |
|--------|--------|
| `PUBLISHLOUD_API_KEY` | Desk API key (`pl_live_…`) |
| `PUBLISHLOUD_GITHUB_APP_ID` | App ID (number) |
| `PUBLISHLOUD_GITHUB_APP_PRIVATE_KEY` | Full PEM contents. Paste with real newlines, or a single line using `\n` |

Optional: `PUBLISHLOUD_GITHUB_APP_INSTALLATION_ID` (usually auto-detected).

## 4. Workflow

```yaml
- uses: slingbiz/publishloud-pr-ship-note@v1
  with:
    api-key: ${{ secrets.PUBLISHLOUD_API_KEY }}
    github-token: ${{ github.token }}
    github-app-id: ${{ secrets.PUBLISHLOUD_GITHUB_APP_ID }}
    github-app-private-key: ${{ secrets.PUBLISHLOUD_GITHUB_APP_PRIVATE_KEY }}
    on-mode: opened
```

Permissions on the job:

```yaml
permissions:
  contents: read
  pull-requests: write
  issues: write
```

## Verify

Re-run the Action on a PR. The comment author should be **PublishLoud** (or your app slug) with your logo — not github-actions.
