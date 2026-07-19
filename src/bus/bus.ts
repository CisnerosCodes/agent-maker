// Message bus — the company's spine. Every message between the user, the CEO,
// and workers flows through here; Slack and the dashboard are thin adapters.
//
// Why not Slack as the transport? Rate limits, unstructured payloads, no
// replay, auth friction, and it can't be demoed offline. The bus is persisted,
// streamed over SSE, testable, and gives the SecurityGate one choke point to
// scan every inter-agent message.

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { EventEmitter } from "node:events";
import type { BusMessage } from "../types.js";

const DATA_DIR = process.env.REGISTRY_DIR ?? "./data";
const FILE = `${DATA_DIR}/messages.json`;

class Bus extends EventEmitter {
  private messages: BusMessage[] = [];

  constructor() {
    super();
    if (existsSync(FILE)) {
      try { this.messages = JSON.parse(readFileSync(FILE, "utf8")); }
      catch { console.warn(`[Bus] corrupt ${FILE} — starting with empty message log`); this.messages = []; }
    }
  }

  post(msg: Omit<BusMessage, "id" | "ts">): BusMessage {
    const full: BusMessage = { id: randomUUID().slice(0, 8), ts: new Date().toISOString(), ...msg };
    this.messages.push(full);
    this.persistAsync();
    this.emit("message", full);
    return full;
  }

  thread(threadId: string): BusMessage[] {
    return this.messages.filter((m) => m.threadId === threadId);
  }

  recent(limit = 200): BusMessage[] {
    return this.messages.slice(-limit);
  }

  clear() {
    this.messages = [];
    this.persistAsync();
  }

  private persistAsync() {
    mkdirSync(DATA_DIR, { recursive: true });
    const data = JSON.stringify(this.messages, null, 2);
    writeFileSync(FILE, data);
  }
}

export const bus = new Bus();
