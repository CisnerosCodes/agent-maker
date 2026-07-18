// Factory — turns an AgentSpec from the CEO into a running, contained worker.
//
// Pipeline: spec -> vault identity -> OpenShell policy -> NemoClaw spawn -> registry.
// Every step emits an AgentEvent so the dashboard shows provisioning live.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { AgentRecord, AgentSpec } from "../types.js";
import { issueIdentity } from "../vault/vault.js";
import { registry } from "../registry/registry.js";

export async function createAgent(spec: AgentSpec, parentId: string): Promise<AgentRecord> {
  const id = `${spec.role}-${randomUUID().slice(0, 8)}`;
  const record: AgentRecord = {
    id,
    spec,
    identity: null as any, // set below
    status: "provisioning",
    parent: parentId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    log: [],
  };
  registry.upsert(record, "Factory received spec");

  // 1. Issue identity: email (Resend-backed) + ONLY the credentials this role needs.
  record.identity = await issueIdentity(spec);
  registry.upsert(record, `Identity issued: ${record.identity.email}`);

  // 2. Render the OpenShell policy for this role.
  //    TODO(Sky): template policies/<spec.policyTemplate> with allowed endpoints
  //    derived from spec.credentials (e.g. APIFY_TOKEN -> allow api.apify.com only).
  const policyPath = await renderPolicy(spec, id);
  registry.upsert(record, `OpenShell policy rendered: ${policyPath}`);

  // 3. Spawn NemoClaw worker in an OpenShell sandbox.
  //    TODO(Sky): shell out to nemoclaw CLI non-interactively, e.g.
  //    NEMOCLAW_AGENT=openclaw NEMOCLAW_PROVIDER=build NEMOCLAW_YES=1 nemoclaw onboard --sandbox <id> --policy <policyPath>
  //    (confirm exact flags against NemoClaw docs / llms.txt)
  record.status = "starting";
  record.sandbox = `sandbox-${id}`;
  registry.upsert(record, "NemoClaw sandbox starting");

  // 4. Hand the worker its objective (through the SecurityGate).
  record.status = "working";
  registry.upsert(record, `Objective delivered: ${spec.objective}`);

  return record;
}

async function renderPolicy(spec: AgentSpec, agentId: string): Promise<string> {
  // Render the role template into a per-agent policy NemoClaw can consume.
  // TODO(Sky): verify template fields against the real OpenShell schema.
  const outPath = `policies/rendered/${agentId}.yaml`;
  const templatePath = `policies/${spec.policyTemplate}`;
  const template = existsSync(templatePath)
    ? readFileSync(templatePath, "utf8")
    : `# no template ${spec.policyTemplate} — default-deny\nagent: "{{AGENT_ID}}"\nsandbox: "{{SANDBOX_NAME}}"\nnetwork:\n  default: deny\n`;
  const rendered = template
    .replaceAll("{{AGENT_ID}}", agentId)
    .replaceAll("{{SANDBOX_NAME}}", `sandbox-${agentId}`);
  mkdirSync("policies/rendered", { recursive: true });
  writeFileSync(outPath, rendered);
  return outPath;
}
