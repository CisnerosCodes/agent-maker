// Shared types for the agent-maker ecosystem.

export type AgentRole = "ceo" | "research" | "store-builder" | "copywriter" | string;

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
  identity: AgentIdentity;
  status: AgentStatus;
  parent: string;            // agent id that requested the spawn (usually the CEO)
  sandbox?: string;          // NemoClaw sandbox name
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
