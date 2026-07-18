# Setup checklist — from zero to running demo

Written for someone who has never touched this repo (or a terminal). Follow it
top to bottom; every step says how to check it worked. Total time with no keys:
about 5 minutes.

## 1. Install the two things you install by hand

1. **Node.js 22 (LTS)** — download from https://nodejs.org, run the installer,
   accept defaults. *Check:* open a new terminal (Windows: press Start, type
   "powershell", Enter) and run `node --version` — you should see `v22.x` (or
   at least `v20.x`).
2. **git** — download from https://git-scm.com, accept defaults.
   *Check:* `git --version` prints a version.

If a command says "not recognized", close the terminal and open a new one —
installers only affect new windows.

## 2. Get the code and start it

```bash
git clone https://github.com/CisnerosCodes/agent-maker.git
cd agent-maker
git pull                # if you cloned before: make sure you have the LATEST code
npm install             # ~30 seconds; installs only dev tooling
npm run doctor          # <-- the pre-flight check. Read what it says.
npm run dev             # starts the app
```

`npm run doctor` tests your machine AND live-tests any keys you have — it tells
you in plain English what works, what is optional, and the exact fix for
anything broken. You can run it as many times as you want.

Then open **http://localhost:4000/setup** — the same checklist as a web page,
re-runnable with one click. When it is green/amber only, open
**http://localhost:4000/app** (Mission Control).

*Check:* the terminal printed `Dashboard: http://localhost:4000` and the org
chart page loads.

## 3. Run the demo with ZERO keys (this always works)

1. In Mission Control, type a goal: `make me a shopify store` → **Launch**.
2. A yellow banner appears: the CEO asks which niche. Type
   `trending sneakers, 3 products` in the banner and press **Answer the CEO**.
3. Watch the org hire itself and the progress bars move. Anything not backed by
   a real key is honestly labeled **SIM**.
4. Click **Inject poisoned doc** (left sidebar) → a red security banner appears
   → click **Deny** → the poisoned document is quarantined.
5. **Reset demo** asks you to click twice — that is on purpose, it wipes everything.

If any button seems to do nothing, look at the bottom-right corner: every
action now pops a small toast telling you what happened (including errors).

## 4. Add keys, one at a time (all optional)

Open **Connections** in the left sidebar. Each row says what the key unlocks,
where to get it, and — the important part — **when you save a key it is
immediately tested with a real call to the provider**. You will see either
"✓ Verified" or "✗ Saved, but the live test failed: …" with the exact reason
(wrong key, out of credit, wrong store URL, etc.).

Recommended order (each one helps the next):

| # | Key | What turns real |
|---|-----|-----------------|
| 1 | Resend | Agent email identities |
| 2 | Claude **or** NVIDIA key (either) | Real AI output from copywriter/strategist |
| 3 | Shopify Admin token + store URL | Real products created in your store |
| 4 | Apify token + actor | Live product scraping for research |
| 5 | HiddenLayer client id + secret | Authoritative security scanning |

**Important HiddenLayer note:** if the HiddenLayer credentials are set but
*wrong*, the security gate fails closed — every agent message pauses for your
approval, which looks like "everything is stuck". The doctor and the Connections
verify call both catch this. If you do not have working HiddenLayer creds,
simply leave both fields empty — the built-in heuristic scanner still runs the
whole security demo.

## 5. Something is weird? In this order:

1. **http://localhost:4000/setup** → Run all checks. Read the red rows.
2. `npm run doctor` in the terminal (works even when the server won't start).
3. `git pull` then `npm install` again — you may be on stale code.
4. Restart the server (Ctrl+C in the terminal, then `npm run dev`). Agents left
   over from the previous session are automatically marked `terminated` — that
   is expected, hire a new org with a new goal.
5. Port already in use? The server now tells you exactly what to type.
