// Escalation store — a flagged detection becomes a pending human decision.
// The worker (or bus adapter) awaits the returned promise; the dashboard's
// approve/deny buttons (or Slack later) resolve it. First resolution wins.

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { Escalation, ScanResult } from "../types.js";

type Resolver = (verdict: "approved" | "denied") => void;

class Escalations extends EventEmitter {
  private items = new Map<string, Escalation>();
  private resolvers = new Map<string, Resolver>();

  create(agentId: string, reason: string, scan: ScanResult, content: string): { escalation: Escalation; decision: Promise<"approved" | "denied"> } {
    const escalation: Escalation = {
      id: `esc-${randomUUID().slice(0, 6)}`,
      agentId,
      reason,
      scan,
      content: content.slice(0, 400),
    };
    this.items.set(escalation.id, escalation);
    const decision = new Promise<"approved" | "denied">((resolve) => this.resolvers.set(escalation.id, resolve));
    this.emit("escalation", escalation);
    return { escalation, decision };
  }

  // `id` may be an escalation id (esc-…) OR an agent id. The dashboard buttons
  // send the agent id, so fall back to that agent's newest pending escalation.
  resolve(id: string, verdict: "approved" | "denied"): Escalation | undefined {
    const escalation =
      this.items.get(id) ??
      [...this.items.values()].reverse().find((e) => e.agentId === id && !e.resolved);
    if (!escalation || escalation.resolved) return escalation;
    escalation.resolved = verdict;
    this.resolvers.get(escalation.id)?.(verdict);
    this.resolvers.delete(escalation.id);
    this.emit("escalation", escalation);
    return escalation;
  }

  all(): Escalation[] { return [...this.items.values()]; }
  pending(): Escalation[] { return this.all().filter((e) => !e.resolved); }
  clear() { this.items.clear(); this.resolvers.clear(); }
}

export const escalations = new Escalations();
