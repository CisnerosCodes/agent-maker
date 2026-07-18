# Testing guide (Sky's lane, but works for anyone)

A scripted pass through every feature, with the expected result for each step.
Run it top to bottom after `git pull` + `npm install`. Nothing here needs a key
until §5.

## 0. Pre-flight

```bash
npm run doctor
```
Expected: Node/network/data rows green. Key rows show "Not connected" (grey) —
or, if you set keys, a LIVE verdict per key. **A key that is set but broken
says exactly why** (401, out of credit, wrong store URL, bad HL creds…).

## 1. Boot + stale-state reconcile

```bash
npm run dev
```
Expected: two lines — the dashboard URL and the /setup URL. If you ran the app
before, agents stranded "working"/"blocked" by the old session are marked
`terminated` with a log line ("Server restarted…"). No zombie approve/deny rows.

Port test: start a second `npm run dev` → it must exit immediately with a
message telling you the exact command to run on another port.

## 2. The offline demo path (no keys)

1. `/app` → goal: `make me a shopify store` → Launch.
   Expected: button shows "Launching…", then a toast, then a **yellow CEO
   question banner on the page** (not hidden in the chat panel).
2. Answer in the banner: `trending sneakers, 3 products`.
   Expected: toast "Answer sent", org plan posts, agents hire, bars move.
   Research runs REAL (network fetch), builder/copy are labeled SIM.
3. While a REAL task runs its bar pulses and the ETA column says "thinking…" —
   slow is visibly alive, never frozen.
4. Goal completes → deliverable line in the goal strip; Run Memory strip
   appears after the first completed run.
5. Repeat the same goal + same niche answer.
   Expected: run 2 reuses run 1's findings ("0 re-scrapes"), finishes faster,
   and the Run Memory strip shows the delta once — no duplicate rows.

## 3. Security demo

1. **Inject poisoned doc** with no research agent (fresh reset).
   Expected: red toast telling you to launch a goal first — NOT a silent no-op.
2. Launch a goal, let research spawn, then Inject poisoned doc.
   Expected: toast confirms the injection; the red escalation banner appears;
   the research agent's row shows **blocked** with Approve/Deny buttons.
3. Click **Deny** — on the ROW (not the banner).
   Expected: it works (rows resolve by agent id now), success toast, the banner
   clears, and the agent goes back to its previous status — it does not stay
   blocked forever.
4. Inject again, approve from the banner this time.
   Expected: "proceeding (OpenShell egress still blocks the exfil host)".
5. Clicking Approve/Deny on an already-resolved escalation → error toast
   ("may already be resolved"), nothing breaks.

## 4. Failure cascade (the hang that used to eat demos)

Kill your network (or set `RESEARCH_SOURCE_URL=http://localhost:1` in .env),
launch a store goal, answer the niche question.
Expected: research fails with a visible message → store-builder and copywriter
are **skipped** ("upstream task failed"), the goal ends `failed`, the ticker
stops. Nothing hangs at "queued" forever. Remove the env line after.

## 5. Key lanes (yours: HiddenLayer)

1. Paste HL client id + secret in Connections.
   Expected: "verifying with a live call…" then ✓ or ✗ **with the reason**.
   The token exchange is the test — this is where bad creds show up.
2. Broken-creds behavior: with bad HL creds saved, the gate fails CLOSED and
   every message escalates. The doctor's HL row explains this and the fix
   (fix the creds or clear them). Verify the explanation shows.
3. With good creds: `/setup` HL row green; injections now carry HL categories
   merged with the heuristic ones.
4. MCP lane: `claude mcp add agent-maker -- npx tsx src/mcp/server.ts` with the
   dashboard running, then ask the agent to "run a system check" — the
   `system_check` tool returns the same doctor report. `run_security_demo`
   returns immediately (no longer blocks the tool call until a human clicks).

## 6. Evals

```bash
npm run eval -- --backend cli --models haiku --trials 1   # uses Claude login, no key
```
Expected: per-level PASS/CSR lines; report written to data/evals/; `/evals`
page shows it within 3s. Model calls time out at 3 minutes (MODEL_TIMEOUT_MS
to change) instead of hanging the run.

## Known limits (do not file these)

- Store-builder/copywriter without keys are SIM by design, labeled on screen.
- `data/` is not committed — your first boot is always an empty company.
- Company profile survives "Reset demo" (only the wizard's answers); delete
  `data/company.json` to re-run onboarding.
