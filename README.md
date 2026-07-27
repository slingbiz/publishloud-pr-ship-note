# <img src="https://www.publishloud.com/android-chrome-192x192.png" alt="PublishLoud" width="36" height="36" align="absmiddle" /> PublishLoud PR Ship Note

**Build in public without the marketing grind.**

This GitHub Action turns your pull requests and commits into smart X and LinkedIn ship-note drafts. You keep building. PublishLoud handles the marketing draft. You review and publish - nothing posts automatically.

## Why

Shipping in silence wastes distribution. Every merge is a story your users and followers should hear. PublishLoud writes that story from your PR context so you stay consistent on social without leaving the codebase.

## What you get

- Professional PR comment with X and LinkedIn drafts
- One-click Open / Publish links into your PublishLoud desk
- Human approval before anything goes live
- Works on merge by default (optional: also on PR open)

## Install

1. In PublishLoud: **Settings → GitHub → PR ship notes** → create an API key.
2. Add GitHub secret `PUBLISHLOUD_API_KEY`.
3. Add `.github/workflows/publishloud-ship-note.yml`:

```yaml
name: PublishLoud ship note
on:
  pull_request:
    types: [opened, ready_for_review, closed]
jobs:
  ship-note:
    if: github.event.action != 'closed' || github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read
    steps:
      - uses: slingbiz/publishloud-pr-ship-note@v1
        with:
          api-key: ${{ secrets.PUBLISHLOUD_API_KEY }}
          github-token: ${{ github.token }}
          # on-mode: merged   # default - comment when PR is merged
          # on-mode: opened   # also comment when PR is opened / ready for review
```

## Access

- **Trial or Pro:** full draft comment with Open / Publish links.
- **Expired free:** static upgrade comment only (no LLM cost).

## Skip

- Bots (Dependabot, etc.)
- Draft PRs (until ready for review or merge)
- Label `publishloud-skip`

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `api-key` | yes | | `pl_live_…` from PublishLoud |
| `api-base-url` | no | `https://api.baloon.dev` | API host |
| `on-mode` | no | `merged` | `merged` or `opened` |
| `github-token` | no | `github.token` | Needs `pull-requests: write` |

## Comment style

Professional GitHub markdown (alerts, branding). No emoji spam. Human CTAs only.

## Marketplace

Category: **Publishing**. See `MARKETPLACE.md`.
