# start-it-orchestrator

Self-hosted MCP server coordinating multiple Claude accounts (Director + Backend A/B,
Frontend A/B, Stress Tester) working the Start-It demo. No external API calls except
Slack (optional — server runs fine without it, just skips escalation).

## Tools

| Tool | Who calls it | What it does |
|---|---|---|
| `create_task` | Director | Queue a task for a role (`backend`/`frontend`/`stress`) |
| `claim_task` | Worker | Pull next pending task for its role |
| `submit_result` | Worker | Submit output, moves task to `awaiting_review` |
| `review_result` | Director | `approve` (closes) or `revise` (re-queues with notes) |
| `list_tasks` | Anyone | Filter by `status`/`role` |
| `fire` | Anyone | Post a signal (`critical`/`high`/`medium`). critical/high auto-post to Slack, threaded under today's digest |
| `drain` | Director | Pull + mark-read undrained signals |

## Env vars (set in Manufact)

- `SLACK_BOT_TOKEN` — bot token with `chat:write` scope, needed only for Slack escalation
- `SLACK_CHANNEL_ID` — defaults to `C0BT9N3FDTJ` (#start-it)
- `DATA_FILE` — defaults to `./data/orchestrator.json`. **Point this at a mounted
  volume if Manufact supports one** — otherwise task/signal state resets on every
  redeploy (only the Slack digest history survives, since that's in Slack itself).
- `PORT` — defaults to 8080

## Connecting a Claude account to this server

Add as a custom connector pointing at `https://<your-manufact-domain>/mcp`.

## Local run

```
npm install
npm start
curl localhost:8080/api/health
```

## Deploy

Push this repo to GitHub, then:

```
Manufact:deploy  (point at the repo)
```

Manufact builds from the Dockerfile automatically.
