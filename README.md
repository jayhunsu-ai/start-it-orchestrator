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

- `SUPABASE_URL` — e.g. `https://xtyytouelpedvecuuzfv.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` — **service_role key, not anon/publishable.** The
  orchestrator tables (`orchestrator_tasks`, `orchestrator_signals`,
  `orchestrator_digests`) have RLS enabled with no anon-role policies, so only
  the service_role key can read/write them — this keeps them unreachable via
  the Start-It app's public anon key while still living in the same project.
- `SLACK_BOT_TOKEN` — bot token with `chat:write` scope, needed only for Slack escalation
- `SLACK_CHANNEL_ID` — defaults to `C0BT9N3FDTJ` (#start-it)
- `PORT` — defaults to 8080

Task/signal/digest state now lives in Supabase Postgres, not a local file —
it survives redeploys and host switches (Render/Manufact/wherever) since it's
no longer tied to the container's ephemeral disk.

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
