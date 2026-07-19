// Shared types for the agent-maker ecosystem.

// strategist/analyst are real pure-LLM roles (worker-capability §1), no longer
// ghosts. The trailing `string` keeps scratch/custom roles assignable.
export type AgentRole = "ceo" | "research" | "store-builder" | "copywriter" | "strategist" | "analyst" | string;

export type AgentStatus =
  | "provisioning" // Factory is issuing identity + policy
  | "starting"     // NemoClaw sandbox booting
  | "working"      // actively on a task
  | "waiting"      // heartbeat idle, waiting for next cycle
  | "blocked"      // needs human approval (escalation pending)
  | "done"
  | "failed"
  | "terminated";

export interface AgentSpec {
  role: AgentRole;
  name: string;              // e.g. "research-01"
  objective: string;         // what the CEO wants from this agent
  tools: string[];           // e.g. ["apify", "web-fetch"]
  credentials: string[];     // vault keys to issue, e.g. ["APIFY_TOKEN"]
  policyTemplate: string;    // filename in policies/, e.g. "worker-research.yaml"
  model?: string;            // Nemotron slug; Factory picks default if omitted
  reasoning?: "low" | "medium" | "high"; // Nemotron thinking budget (§6.2); maps to
  //                          chat_template_kwargs.enable_thinking/low_effort. Factory defaults per role.
}

export interface AgentIdentity {
  name: string;
  email: string;             // e.g. research-01@agentcorp.dev (Resend-backed)
  issuedCredentials: Record<string, string>; // key name -> vault ref (never raw secrets in registry)
  issuedAt: string;
}

export interface AgentRecord {
  id: string;
  spec: AgentSpec;
  // Optional (C12): a record exists in `provisioning`/`failed` BEFORE identity is
  // issued. A vault miss leaves this undefined + status `failed` — never
  // `null as any`, never a crash into the CEO loop. Consumers use `?.`.
  identity?: AgentIdentity;
  status: AgentStatus;
  parent: string;            // agent id that requested the spawn (usually the CEO)
  sandbox?: string;          // per-ROLE NemoClaw sandbox name (== role; reused across hires)
  // Per-TASK session inside the role sandbox (factory-provisioning §2). The real
  // per-hire unit: an agent record + a task session. `session` is the id passed to
  // nemoclaw dispatch (--session-id); `workdir` is its isolated, wiped-on-end
  // workdir (§3, `/workspace/<session>/`) so goal-1 data cannot contaminate goal-2.
  session?: string;
  workdir?: string;
  // Isolation axis (C6), orthogonal to real/sim. `nemoclaw` = provisioned in an
  // OpenShell sandbox; `local` = in-process, UNCONTAINED (break-glass / no live
  // sandbox). Surfaced as an UNCONTAINED badge when `local`.
  containment?: "nemoclaw" | "local";
  createdAt: string;
  updatedAt: string;
  lastHeartbeat?: string;
  log: AgentEvent[];
}

export interface AgentEvent {
  ts: string;
  kind: "status" | "task" | "detection" | "escalation" | "approval" | "info";
  message: string;
  data?: unknown;
}

// --- Message bus (the company's spine; Slack/dashboard are adapters) ---

export interface BusMessage {
  id: string;
  ts: string;
  threadId: string;          // "company" or a goal thread id
  from: string;              // "user" | "ceo" | agent id
  to?: string;               // optional direct recipient
  kind: "chat" | "status" | "question" | "finding" | "system";
  body: string;
}

// --- Goals & tasks (what the dashboard's progress view renders) ---

export interface Goal {
  id: string;
  text: string;
  status: "clarifying" | "planning" | "awaiting-approval" | "running" | "done" | "failed";
  threadId: string;
  createdAt: string;
  deliverable?: string;      // e.g. the store URL
}

// Pending org-plan approval (assisted autonomy mode): the CEO's proposed
// workforce, held for human approve/deny before any agent spawns.
export interface PlanApproval {
  goalId: string;
  goalText: string;
  roles: { name: string; role: string; title: string }[];
}

export interface Task {
  id: string;
  goalId: string;
  title: string;
  agentId?: string;
  status: "pending" | "running" | "done" | "failed";
  progress: number;          // 0-100
  estimateSec: number;
  dependsOn: string[];       // task ids that must be done first
  startedAt?: string;
  finishedAt?: string;
  mode?: "real" | "sim";     // real = model/tool-backed; sim = staged (labeled on the dashboard)
  output?: string;           // human-readable result summary
  outputData?: unknown;      // structured result handed to dependent tasks
}

// --- SecurityGate ---

export type Verdict = "clean" | "flagged" | "blocked";

export interface ScanResult {
  verdict: Verdict;
  categories: string[];      // e.g. ["prompt_injection", "data_leakage"]
  raw?: unknown;             // full HiddenLayer response for the dashboard
}

export type IoKind =
  | "user_prompt"
  | "model_response"
  | "tool_call"
  | "tool_result"
  | "ingested_document";

export interface Escalation {
  id: string;
  agentId: string;
  reason: string;
  scan: ScanResult;
  content: string;           // redacted excerpt shown to the approver
  resolved?: "approved" | "denied";
}
