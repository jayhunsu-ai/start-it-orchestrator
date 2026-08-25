// Escalates CRITICAL/HIGH signals to Slack, threaded under one digest root
// message per UTC day so #start-it doesn't turn into a flat firehose.
// MEDIUM signals are never sent to Slack — they stay in the signals table only.
import { getDigestTs, setDigestTs } from "./store.js";

const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN || "";
const CHANNEL_ID = process.env.SLACK_CHANNEL_ID || "C0BT9N3FDTJ"; // #start-it

async function slackApi(method, body) {
  if (!SLACK_TOKEN) {
    console.warn(`[slack] SLACK_BOT_TOKEN not set — skipping ${method}`);
    return null;
  }
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SLACK_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) console.error(`[slack] ${method} failed:`, json.error);
  return json;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

async function getOrCreateDigestTs() {
  const key = todayKey();
  let ts = getDigestTs(key);
  if (ts) return ts;

  const res = await slackApi("chat.postMessage", {
    channel: CHANNEL_ID,
    text: `:rotating_light: *Start-It escalations — ${key}*\nCRITICAL/HIGH signals from today's agents thread below.`,
  });
  if (res?.ok) {
    ts = res.ts;
    setDigestTs(key, ts);
  }
  return ts;
}

const PRIORITY_EMOJI = { critical: ":red_circle:", high: ":large_orange_circle:" };

export async function escalate(signal) {
  if (signal.priority !== "critical" && signal.priority !== "high") return;

  const threadTs = await getOrCreateDigestTs();
  const emoji = PRIORITY_EMOJI[signal.priority] || "";
  const text = `${emoji} *${signal.priority.toUpperCase()}* from \`${signal.worker_id}\`\n${signal.content}${
    signal.data ? "\n```" + JSON.stringify(signal.data, null, 2) + "```" : ""
  }`;

  await slackApi("chat.postMessage", {
    channel: CHANNEL_ID,
    text,
    thread_ts: threadTs || undefined,
    reply_broadcast: signal.priority === "critical", // CRITICAL also surfaces in main channel
  });
}
