// Model backends — how the harness talks to a model under test.
//
//   api    — Anthropic Messages API (needs ANTHROPIC_API_KEY)
//   cli    — headless `claude -p` (uses your Claude Code login; run `claude` once
//            interactively if you get a 401)
//   nvidia — any OpenAI-compatible endpoint; defaults to NVIDIA hosted Nemotron
//            (needs NVIDIA_INFERENCE_API_KEY). This is the same interface the
//            Factory will use for worker inference, so eval results transfer.
//   file   — grade pre-collected responses from a JSON file:
//            { "<levelId>:<trial>": "raw response text", ... }
//            Used when responses are gathered out-of-band (e.g. via Claude
//            Code subagents) and for offline regrading.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import type { ModelBackend } from "./types.js";

const DEFAULT_MAX_TOKENS = 1024;
// Slow models are fine; HUNG requests are not. Without a timeout, one stalled
// HTTP call left a worker task frozen mid-progress with no error and nothing
// on screen. 3 minutes is generous headroom for the slowest reasoning model.
const REQUEST_TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS ?? 180000);

export class AnthropicApiBackend implements ModelBackend {
  name = "api";
  constructor(private apiKey: string) {}

  async complete(prompt: string, opts: { model: string; maxTokens?: number }) {
    const start = Date.now();
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data: any = await res.json();
    const text = (data.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");
    return { text, latencyMs: Date.now() - start };
  }
}

export class ClaudeCliBackend implements ModelBackend {
  name = "cli";

  complete(prompt: string, opts: { model: string }) {
    const start = Date.now();
    return new Promise<{ text: string; latencyMs: number }>((resolve, reject) => {
      // shell:true so the claude .cmd shim resolves on Windows; args are static.
      const child = spawn("claude", ["-p", "--model", opts.model], {
        shell: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) reject(new Error(`claude CLI exit ${code}: ${(err || out).slice(0, 300)}`));
        else resolve({ text: out.trim(), latencyMs: Date.now() - start });
      });
      child.stdin.write(prompt);
      child.stdin.end();
    });
  }
}

export class OpenAICompatBackend implements ModelBackend {
  name: string;
  constructor(
    private apiKey: string,
    private baseUrl = "https://integrate.api.nvidia.com/v1",
    name = "nvidia",
  ) {
    this.name = name;
  }

  async complete(prompt: string, opts: { model: string; maxTokens?: number }) {
    const start = Date.now();
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${this.name} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data: any = await res.json();
    return { text: data.choices?.[0]?.message?.content ?? "", latencyMs: Date.now() - start };
  }
}

export class ResponsesFileBackend implements ModelBackend {
  name = "file";
  private responses: Record<string, string>;

  constructor(path: string) {
    this.responses = JSON.parse(readFileSync(path, "utf8"));
  }

  async complete(_prompt: string, opts: { levelId: string; trial: number }) {
    const key = `${opts.levelId}:${opts.trial}`;
    if (!(key in this.responses)) throw new Error(`No recorded response for ${key}`);
    return { text: this.responses[key], latencyMs: null };
  }
}

export function makeBackend(kind: string, fileArg?: string): ModelBackend {
  switch (kind) {
    case "api": {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error("backend=api requires ANTHROPIC_API_KEY in the environment or .env");
      return new AnthropicApiBackend(key);
    }
    case "cli":
      return new ClaudeCliBackend();
    case "nvidia": {
      const key = process.env.NVIDIA_INFERENCE_API_KEY;
      if (!key) throw new Error("backend=nvidia requires NVIDIA_INFERENCE_API_KEY");
      return new OpenAICompatBackend(key, process.env.NVIDIA_API_BASE ?? undefined);
    }
    case "file": {
      if (!fileArg) throw new Error("backend=file requires --file <responses.json>");
      return new ResponsesFileBackend(fileArg);
    }
    default:
      throw new Error(`Unknown backend "${kind}" (expected api | cli | nvidia | file)`);
  }
}
