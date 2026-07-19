# Proof of real runs — 2026-07-19

Six goals ran end-to-end through the REAL product pipeline — hiring, spawn
authority, SecurityGate (live HiddenLayer + heuristic floor), MetaGPT-style
handoffs, run memory, honest real/sim labeling — with **zero scripted content**.
Inference was **Claude (Anthropic)** through a local subagent bridge standing in
for an API key: the app made normal OpenAI-compatible `chat/completions` calls
to `FEATHERLESS_API_BASE=http://127.0.0.1:4199/v1`; a Claude Code session
answered each one with a real Claude completion. Paste a real `ANTHROPIC_API_KEY`
and the identical pipeline runs with no code change.

Full event recordings (every bus message, task transition, escalation, gate
verdict, with timestamps): `data/recordings/run*.json`. Stats: `index.json`.
Worker-persona reviews: `reviews.json`. Improvement findings: `findings.json`.

## The runs

| Run | Vertical | Crew | Real | Duration | Notable |
|-----|----------|------|------|----------|---------|
| 1 | Commerce — handmade ceramic planters store | research → store-builder → copywriter | 2/3 (store sim: no Shopify key) | ~3 min | Live poisoned-doc injection HARD-BLOCKED by the gate (heuristics + HiddenLayer), no human needed; workers refused to launder an off-topic catalog |
| 2 | Social — BuzzBrew cold-brew launch campaign | research → strategist → copywriter | **3/3** | ~4 min | First zero-simulation run; autonomous governance; full channel plan + week of post copy |
| 3 | SEO — vinyl webshop (mis-route, kept on purpose) | store crew (wrong!) | 2/3 | ~2 min | "webshop" matched the store playbook — found live, router fixed, see run 3b |
| 3b | SEO rerun after the router fix | keyword-miner → search-scout → listing-optimizer | **3/3** | ~4 min | Correct crew hired; 53-term intent-labeled keyword set; honest no-live-crawl disclaimers |
| 4 | Support — LumenBox smart-lamp helpdesk | kb-curator → support-writer → qa-auditor | **3/3** | ~3.5 min | qa-auditor caught the support-writer inventing an unsourced "paid-repair exception" and HANDED IT BACK |
| 5 | Fact-check — VitaGlow supplements claims | critic → reviser | **2/2** | ~4 min | "Cures fatigue" flagged as illegal-claim territory; refused to fabricate citations; rewrote only what failed |

## The learning loop (applied between runs, all committed)

- Run 1 (Atlas): clarifying question asked for a niche the goal already stated →
  clarify regex + `nicheFor` widened. Off-topic catalog fallback was presented
  as niche-matched → now labeled out loud on the bus, in the model prompt, and
  in the summary. Attack quarantine mis-credited "the operator" → now credits
  the gate's auto-block. Goal summaries now tally REAL vs simulated tasks.
- Run 2 (Nova): autonomous-mode auto-approvals were invisible to the
  escalations audit trail → now recorded as pre-resolved escalation records.
- Run 3 (Sage): first-match playbook routing sent an SEO goal to a store crew →
  scored keyword-hit routing; run 3b proves the fix on the same goal text.

## Open findings (next)

- HiddenLayer flags the CEO's own task prompts as HIGH prompt-injection when
  they quote the content being audited (run 5) — needs per-category gate policy
  or prompt-context whitelisting; supervised mode is noisy without it.
- Non-commerce goals still run product-catalog research (runs 2/4 got cosmetics
  data for coffee/lamps) — research should be niche-aware per playbook.
- Goal text with em dashes can arrive mojibaked via some shells (display only).
- The worker reviews in `reviews.json` are AI-persona-authored and labeled as
  such wherever displayed — keep that label.
