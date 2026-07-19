// Registry — the single source of truth the dashboard streams from.
// JSON-file backed for the hackathon (swap for Supabase if credits arrive and time allows).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { EventEmitter } from "node:events";
import type { AgentRecord } from "../types.js";

const DATA_DIR = process.env.REGISTRY_DIR ?? "./data";
const FILE = `${DATA_DIR}/registry.json`;
const LOG_CAP = 200;

class Registry extends EventEmitter {
  private agents = new Map<string, AgentRecord>();

  constructor() {
    super();
    if (existsSync(FILE)) {
      try {
        const arr: AgentRecord[] = JSON.parse(readFileSync(FILE, "utf8"));
        for (const a of arr) this.agents.set(a.id, a);
      } catch {
        console.warn(`[Registry] corrupt ${FILE} — starting with empty registry`);
      }
    }
  }

  upsert(record: AgentRecord, message?: string) {
    record.updatedAt = new Date().toISOString();
    if (message) {
      record.log.push({ ts: record.updatedAt, kind: "status", message });
      if (record.log.length > LOG_CAP) record.log.shift();
    }
    this.agents.set(record.id, record);
    this.persistAsync();
    this.emit("update", record); // dashboard SSE hooks this
  }

  get(id: string) { return this.agents.get(id); }
  all(): AgentRecord[] { return [...this.agents.values()]; }

  clear() {
    this.agents.clear();
    this.persistAsync();
  }

  private persistAsync() {
    mkdirSync(DATA_DIR, { recursive: true });
    const data = JSON.stringify(this.all(), null, 2);
    writeFileSync(FILE, data);
  }
}

export const registry = new Registry();
