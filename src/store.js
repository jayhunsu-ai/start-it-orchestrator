// Supabase-backed store. Tasks/signals/digest state persist independently of
// whatever container is running the server — survives redeploys and host
// switches (Render/Manufact/wherever). Connects with the service_role key,
// which bypasses RLS; these tables have no anon-role policies, so they are
// not reachable via the Start-It app's public anon key.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (service_role key, not anon)."
  );
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function mustNotError({ error }, context) {
  if (error) throw new Error(`[store] ${context}: ${error.message}`);
}

// ---- Tasks ----

export async function createTask({ role, instructions, context }) {
  const res = await sb
    .from("orchestrator_tasks")
    .insert({ role, instructions, context: context || "" })
    .select()
    .single();
  mustNotError(res, "createTask");
  return res.data;
}

export async function claimTask({ worker_id, role }) {
  // Find the oldest pending task for this role, then claim it.
  const { data: candidate, error: findErr } = await sb
    .from("orchestrator_tasks")
    .select("id")
    .eq("status", "pending")
    .eq("role", role)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (findErr) throw new Error(`[store] claimTask (find): ${findErr.message}`);
  if (!candidate) return null;

  // Guard against two workers racing the same task: only succeeds if still pending.
  const res = await sb
    .from("orchestrator_tasks")
    .update({ worker_id, status: "in_progress", updated_at: new Date().toISOString() })
    .eq("id", candidate.id)
    .eq("status", "pending")
    .select()
    .maybeSingle();
  mustNotError(res, "claimTask (update)");
  return res.data || null; // null means another worker claimed it first
}

export async function submitResult({ task_id, output }) {
  const res = await sb
    .from("orchestrator_tasks")
    .update({ output, status: "awaiting_review", updated_at: new Date().toISOString() })
    .eq("id", task_id)
    .select()
    .single();
  mustNotError(res, "submitResult");
  return res.data;
}

export async function reviewResult({ task_id, verdict, notes }) {
  const status = verdict === "approve" ? "approved" : "pending";
  const res = await sb
    .from("orchestrator_tasks")
    .update({ notes: notes || null, status, updated_at: new Date().toISOString() })
    .eq("id", task_id)
    .select()
    .single();
  mustNotError(res, "reviewResult");
  return res.data;
}

export async function listTasks({ status, role } = {}) {
  let q = sb.from("orchestrator_tasks").select("*").order("created_at", { ascending: true });
  if (status) q = q.eq("status", status);
  if (role) q = q.eq("role", role);
  const res = await q;
  mustNotError(res, "listTasks");
  return res.data;
}

// ---- Signals ----

export async function fireSignal({ worker_id, priority, content, data }) {
  const res = await sb
    .from("orchestrator_signals")
    .insert({ worker_id, priority, content, data: data || null })
    .select()
    .single();
  mustNotError(res, "fireSignal");
  return res.data;
}

export async function drainSignals({ priority } = {}) {
  let q = sb.from("orchestrator_signals").select("*").eq("drained", false);
  if (priority) q = q.eq("priority", priority);
  const { data: matched, error: findErr } = await q;
  if (findErr) throw new Error(`[store] drainSignals (find): ${findErr.message}`);
  if (!matched.length) return [];

  const ids = matched.map((s) => s.id);
  const res = await sb.from("orchestrator_signals").update({ drained: true }).in("id", ids);
  mustNotError(res, "drainSignals (update)");
  return matched;
}

// ---- Slack digest thread tracking (one root message per UTC day) ----

export async function getDigestTs(dateKey) {
  const { data, error } = await sb
    .from("orchestrator_digests")
    .select("slack_ts")
    .eq("date_key", dateKey)
    .maybeSingle();
  if (error) throw new Error(`[store] getDigestTs: ${error.message}`);
  return data?.slack_ts || null;
}

export async function setDigestTs(dateKey, ts) {
  const res = await sb
    .from("orchestrator_digests")
    .upsert({ date_key: dateKey, slack_ts: ts });
  mustNotError(res, "setDigestTs");
}
