# Callsite — Product Design & Architecture

_Define your surface once in TypeScript; generate every agent-facing artifact and run it locally. No hosted control plane._

> **Name & identifiers.** Product: **Callsite** — a capability is exactly a callsite an agent reaches.
> npm scope `@callsitehq` (the bare `@callsite` scope collides with an existing npm account; `hq` lives only on the namespace and never appears in the CLI or product name). CLI binary `callsite` (e.g. `callsite build`, `callsite dev`). Packages: `@callsitehq/core`, `@callsitehq/emit`, `@callsitehq/runtime`, `@callsitehq/cli`. Domain `callsitehq.com`. GitHub org `callsitehq` (rename the current `surface` repo).

---

## Product Design

You define a product's capabilities once, in TypeScript, as a set of intent-level tools — an `id`, a rich natural-language `intent`, typed `input`/`output` schemas, and a `run` handler. From that single source of truth, Callsite generates every agent-facing surface: `mcp.json`, an OpenAPI spec, a ChatGPT app config, a Claude connector config, and a runnable MCP server emitted as importable code. You deploy the outputs wherever you already deploy. Callsite hosts nothing, brokers no auth, and operates no runtime — it is a compiler and a set of libraries you ship on npm.

The value is not the file conversion; it is the layer above it. The source of truth is _intent-shaped_, not transport-shaped, so it carries what OpenAPI cannot — descriptions written for model consumption, destructive-action flags, examples, and per-surface affordances. Authors live entirely above the transport line: they write business logic against typed, pre-validated input and throw one semantic error, never touching JSON-RPC, HTTP status codes, or any surface's wire format. Every moving spec lives below that line, inside a renderer or the runtime engine, where its churn is absorbed without the author's definition ever changing.

---

## High-Level Architecture

The system is a pipeline: TypeScript capability definitions are read into a single intent-shaped intermediate representation (the IR), and every output — the four static configs plus the runtime dispatch engine — is an independent renderer over that IR. The author's definition has no knowledge of any surface; surface-specific knowledge lives in exactly one renderer each, so adding a fifth surface means adding a renderer, not reopening the capability API. The one runtime artifact is a deep module exposing a single web-standard `Request → Response` handler (`fetchHandler`); all vendor conveniences are thin shims over it. The complex decode/validate/dispatch machinery is pulled down into a versioned runtime dependency so generated code stays small, diffable, and patchable by a version bump rather than a re-synth.

### Design in full

**The seam — intent above, transport below.** A capability is a TypeScript object whose `run` function is a pure, runtime-unaware handler. Above `run`: intent and business logic. Below it: JSON-RPC for MCP, HTTP for the OpenAPI surface, and whatever each other surface requires. The same `run` serves every surface; business logic is never forked per channel. This boundary is the load-bearing design decision — `run` is not a thin pass-through to transport, it is the layer at which transport stops existing.

**Validation defines errors out of existence.** Input is parsed against the schema at the boundary, before any business code runs. By the time `run` executes, input is fully typed and valid; the author cannot write a handler that receives malformed input, and writes zero validation branches. Invalid requests are rejected at the boundary with protocol-correct errors (a JSON-RPC error for MCP, an HTTP 4xx for the OpenAPI surface). Symmetrically, the author throws one semantic `CapabilityError`, and each renderer maps it to that surface's native error shape.

**One IR, many renderers.** Definitions compile to an internal representation that is intent-shaped, never OpenAPI-shaped. OpenAPI is one _importer into_ the IR (the bootstrap path: point at an existing spec, get a rough capability graph) and one _renderer out of_ it — never the center. Each static config and the runtime manifest is a pure renderer over the IR.

**The runtime artifact is a deep module with a one-symbol interface.** What you import hides protocol decode, routing, validation, dispatch, error normalization, and encode behind a single `fetchHandler`. Workers, Bun, Deno, and Node consume it directly; Express and `node:http` are four-line shims, not separate generators. One deep thing, many shallow conveniences.

**Generated code stays thin; cleverness lives in the runtime library.** Synth emits a small, boring, diffable manifest that imports `@callsitehq/runtime`. The engine's complexity is pulled downward into that dependency, so generated trees stay trivial and a security fix ships as a version bump.

**Module boundaries — three packages, no I/O bleed.**

| Package   | Responsibility                                                               | Purity                       |
| --------- | ---------------------------------------------------------------------------- | ---------------------------- |
| `core`    | `capability()`, IR types, the validation seam (Standard Schema; Zod default) | Pure — no fs, no network     |
| `emit`    | IR → static artifacts (`mcp.json`, OpenAPI, ChatGPT, Claude connector)       | Pure functions, IR → strings |
| `runtime` | IR + capabilities → the `Request → Response` engine behind `fetchHandler`    | The one deep module          |

**Synth** is then a pure function from config to a folder: read definitions → build IR → hand the IR to `emit` and to a runtime manifest.

**Common case tiny, escape hatches off the path.** `id`, `intent`, `input`, `output`, `run` is a complete capability in ~12 lines. Optional fields — `overrides.<surface>` for channel-specific affordances, raw `passthrough` for "emit exactly this," custom auth mapping — don't appear unless reached for. No complexity tax for unused features.

---

## Appendix

The following are referenced above and warrant their own treatment when the build starts:

- **Capability IR & `capability()` signature.** The exact schema authors write and everything renders off. Getting this abstraction boundary right is load-bearing; it is the one piece worth specifying before any code. _(To be drafted.)_
- **Validation seam (Standard Schema).** How `core` depends on what Zod _produces_ (JSON Schema + a validate function) rather than on Zod itself, enabling Valibot / ArkType / hand-rolled validators as drop-in alternatives.
- **Handler binding model.** With the importable-handler approach, binding inverts: the host imports the generated handler into the environment that already holds backend access and identity, so the generated code carries protocol wiring while business logic and credentials stay with the author. Worth confirming the `ctx` identity pass-through contract.
- **Error taxonomy.** The semantic `CapabilityError` codes and the per-surface mapping table (e.g. `not_found` → JSON-RPC error vs. HTTP 404).
- **Runtime shims.** The four-line `expressHandler` / `node:http` adapters over `fetchHandler`, kept deliberately shallow.
- **OpenAPI importer.** The bootstrap path that ingests an existing spec into the IR — the low-friction adoption wedge — and its inherent lossiness (transport-shaped input into an intent-shaped model).
- **Deferred: hosting/runtime operation.** Live MCP server operation, auth brokering, metering, and observability are explicitly out of this scope and form the eventual paid layer.
