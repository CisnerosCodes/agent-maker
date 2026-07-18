// Local heuristic detector — runs ALWAYS, with or without a HiddenLayer key.
// This is not a replacement for HiddenLayer (Sky wires the real API in
// gate.ts); it's the floor that keeps the escalation demo real when offline.
// Categories are prefixed "heuristic:" so the dashboard shows the source.

const PATTERNS: Array<{ category: string; re: RegExp }> = [
  { category: "heuristic:prompt_injection", re: /ignore\s+(all\s+)?(previous|prior|earlier)\s+instructions/i },
  { category: "heuristic:prompt_injection", re: /system\s*override/i },
  { category: "heuristic:prompt_injection", re: /disregard\s+(your|all)\s+(rules|instructions|guidelines)/i },
  { category: "heuristic:data_exfiltration", re: /(post|send|upload|forward|exfiltrate)\b[^.\n]{0,80}\b(credential|secret|token|api.?key|password)s?/i },
  { category: "heuristic:data_exfiltration", re: /\b(credential|secret|token|password)s?\b[^.\n]{0,60}\bto\s+https?:\/\//i },
  { category: "heuristic:suspicious_endpoint", re: /https?:\/\/[^\s"']*evil[^\s"']*/i },
  { category: "heuristic:privilege_escalation", re: /(grant|give)\s+(me|yourself)\s+(admin|root|full)\s+(access|privileges)/i },
];

export function heuristicScan(content: string): string[] {
  const hits = new Set<string>();
  for (const p of PATTERNS) if (p.re.test(content)) hits.add(p.category);
  return [...hits];
}
