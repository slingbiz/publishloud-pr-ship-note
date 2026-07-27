# PublishLoud PR Ship Note (GitHub Action)

Posts a professional X and LinkedIn ship-note draft as a pull request comment. You review and publish from PublishLoud. Nothing posts to social automatically.

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

## Comment style

Plain, professional markdown. No emoji, no em dashes. Human CTAs only.

## Develop

This package lives in `sling-ai/github-actions/pr-ship-note` until published as the public `publishloud/pr-ship-note` Marketplace repo.

```bash
npm run build
```

## Marketplace

Publish this directory as its own GitHub repository and submit it to the GitHub Marketplace under category "Publishing".
