// Self-contained JSON-file store. No external DB — keeps this fully self-hosted.
// Manufact/Render containers are ephemeral on redeploy, so DATA_DIR should be
// pointed at a mounted volume if one is available; otherwise state resets on redeploy.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";

const DATA_FILE = process.env.DATA_FILE || "./data/orchestrator.json";

function ensureFile() {
  const dir = dirname(DATA_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(DATA_FILE)) {
    writeFileSync(
      DATA_FILE,
      JSON.stringify({ tasks: [], signals: [], digests: {}, seq: { task: 1, signal: 1 } }, null, 2)
    );
  }
}

function load() {
  ensureFile();
  return JSON.parse(readFileSync(DATA_FILE, "utf-8"));
}

function save(db) {
  writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

// ---- Tasks ----

export function createTask({ role, instructions, context }) {
  const db = load();
  const task = {
    id: db.seq.task++,
    role,
    worker_id: null,
    instructions,
    context: context || "",
    status: "pending",
    output: null,
    notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  db.tasks.push(task);
  save(db);
  return task;
}

export function claimTask({ worker_id, role }) {
  const db = load();
  const task = db.tasks.find((t) => t.status === "pending" && t.role === role);
  if (!task) return null;
  task.worker_id = worker_id;
  task.status = "in_progress";
  task.updated_at = new Date().toISOString();
  save(db);
  return task;
}

export function submitResult({ task_id, output }) {
  const db = load();
  const task = db.tasks.find((t) => t.id === task_id);
  if (!task) throw new Error(`task ${task_id} not found`);
  task.output = output;
  task.status = "awaiting_review";
  task.updated_at = new Date().toISOString();
  save(db);
  return task;
}

export function reviewResult({ task_id, verdict, notes }) {
  const db = load();
  const task = db.tasks.find((t) => t.id === task_id);
  if (!task) throw new Error(`task ${task_id} not found`);
  task.notes = notes || null;
  task.status = verdict === "approve" ? "approved" : "pending"; // revise -> back in queue
  task.updated_at = new Date().toISOString();
  save(db);
  return task;
}

export function listTasks({ status, role } = {}) {
  const db = load();
  return db.tasks.filter(
    (t) => (!status || t.status === status) && (!role || t.role === role)
  );
}

// ---- Signals ----

export function fireSignal({ worker_id, priority, content, data }) {
  const db = load();
  const signal = {
    id: db.seq.signal++,
    worker_id,
    priority,
    content,
    data: data || null,
    created_at: new Date().toISOString(),
    drained: false,
  };
  db.signals.push(signal);
  save(db);
  return signal;
}

export function drainSignals({ priority } = {}) {
  const db = load();
  const matched = db.signals.filter((s) => !s.drained && (!priority || s.priority === priority));
  matched.forEach((s) => (s.drained = true));
  save(db);
  return matched;
}

// ---- Slack digest thread tracking (one root message per UTC day) ----

export function getDigestTs(dateKey) {
  const db = load();
  return db.digests[dateKey] || null;
}

export function setDigestTs(dateKey, ts) {
  const db = load();
  db.digests[dateKey] = ts;
  save(db);
}
