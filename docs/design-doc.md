# Callsite - Product Design & Architecture

_Define capabilities once in TypeScript; render static agent artifacts and host
runtime surfaces from the same source of truth._

> **Name & identifiers.** Product: **Callsite**. npm scope:
> `@callsitehq`. CLI binary: `callsite`. Public packages:
> `@callsitehq/core`, `@callsitehq/emit`, `@callsitehq/runtime`,
> `@callsitehq/cli`, and `@callsitehq/zod`.

---

## Product Design

You define a product's capabilities once, in TypeScript, as intent-level tools:
an `id`, a rich natural-language `intent`, typed `input` and `output` schemas,
optional declared errors, examples, surface escape hatches, and a `run` handler.
From that single source of truth, Callsite can render static artifacts and power
runtime surfaces:

- `mcp.json` for MCP tool discovery
- OpenAPI for capability-shaped HTTP calls
- a hosted HTTP runtime for `POST /capabilities/{id}`
- hosted MCP tools registered on an MCP SDK server
- future surfaces such as docs, SDKs, ChatGPT app config, and Claude connector
  config

Callsite does not host a control plane, own auth, own deployment, or replace the
application server. The host app owns lifecycle, identity, services, database
clients, queues, feature flags, logging, and local development. Callsite is a set
of importable libraries plus a CLI for static artifacts.

The value is not file conversion. The value is the layer above each surface. The
source of truth is intent-shaped, not transport-shaped, so it carries what
OpenAPI alone cannot: descriptions written for model consumption, destructive
action flags, semantic error intent, examples, and per-surface affordances.
Authors live above the transport line: they write business logic against typed,
pre-validated input and throw one semantic `CapabilityError`, never formatting
JSON-RPC, choosing HTTP status codes, or forking logic per channel. Surface churn
lives below the line, inside renderers and runtime adapters.

---

## High-Level Architecture

The system has two paths over the same capability definitions:

1. **Static path:** capabilities -> intent-shaped IR -> pure emitters such as
   `mcp.json` and OpenAPI.
2. **Runtime path:** capabilities -> validation and dispatch -> the author's
   `run` function -> protocol-shaped response.

The author's definition has no knowledge of any surface. Surface-specific
knowledge lives in emitters and runtime adapters, so adding another surface
means adding a renderer or adapter, not reopening every capability.

The runtime path is importable and host-composed. The core HTTP runtime is a
web-standard `Request -> Response` handler. Node, Express, and AWS Lambda are
thin adapters over that handler. MCP is different: Callsite registers tools on a
host-owned MCP SDK server and routes `tools/call` through the same validation
and dispatch engine. The SDK owns MCP protocol handling and transports.

### Design in full

**The seam: intent above, transport below.** A capability is a TypeScript object
whose `run` function is runtime-unaware. Above `run`: intent, schemas, semantic
errors, and business logic. Below it: JSON-RPC for MCP, HTTP for the OpenAPI
surface, Lambda event shapes, Express requests, and future transport details.
The same `run` serves every surface; business logic is never forked per channel.
This boundary is the load-bearing design decision.

**Host-owned composition.** Callsite does not own the application process. The
host app owns lifecycle, auth, identity, credentials, database clients, queues,
logging, deployment, local development, and framework choice. Callsite provides
declarative artifacts, runtime functions, and thin adapters that the host imports
inside its own entrypoints. The CLI must not become an application host. Generated
artifacts must stay declarative. Runtime code should be imported as libraries and
composed by the app.

**Dependencies close over capabilities; request facts flow through context.**
Long-lived services belong in the app's composition root and are closed over by
capability factories. Request-scoped facts such as subject, logger, trace data,
or tenant identity flow through `CapabilityContext`. This keeps the context
small and prevents Callsite from becoming a service locator.

**Validation defines malformed-input errors out of business code.** Input is
parsed against the schema at the boundary, before any business code runs. By the
time `run` executes, input is typed and valid; the author writes no input
validation branches there. Invalid requests are rejected at the boundary with
surface-appropriate errors. Symmetrically, the author throws one semantic
`CapabilityError`, and each runtime adapter maps it to that surface's native
shape.

**One IR, many renderers.** Definitions compile to an internal representation
that is intent-shaped, never OpenAPI-shaped. Each static artifact is a pure
renderer over the IR. OpenAPI is a renderer out of the IR, not the center of the
system.

**OpenAPI is capability-shaped RPC.** Each capability renders as a JSON `POST`
operation under `/capabilities/{id}`. This is deliberate. Callsite capabilities
are actions selected by agents, not a REST resource model. Resource modeling can
still exist in the host app; it is not the abstraction Callsite exposes.

**MCP has two outputs with different jobs.** `mcp.json` is a static discovery
artifact emitted from IR. Live MCP execution is runtime integration:
`registerCallsiteTools(server, capabilities, options)` registers tools on a
host-owned MCP SDK server. The host chooses stdio, Streamable HTTP, auth, and any
additional native SDK tools.

**Standard Schema is the validation seam; JSON Schema is injected.** Core
depends on Standard Schema for validation and TypeScript inference. JSON Schema
emission is not part of Standard Schema, so it is injected through
`toJsonSchema`. `@callsitehq/zod` is the first adapter for that seam; core does
not import Zod.

**Generated artifacts stay declarative; cleverness lives in runtime libraries.**
The CLI emits static, inspectable artifacts. Runtime complexity is pulled down
into `@callsitehq/runtime`, which the host app imports directly, so fixes ship as
package version bumps instead of generated tree rewrites.

**Common case tiny, escape hatches off the path.** `id`, `intent`, `input`,
`output`, and `run` are enough for a capability. Optional fields such as
`errors`, `examples`, `overrides.<surface>`, and raw `passthrough` do not appear
unless the author reaches for them.

## Package Boundaries

| Package               | Responsibility                                                                           | Boundary                                                            |
| --------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `@callsitehq/core`    | `capability()`, IR types, Standard Schema validation seam, semantic errors               | Pure; no fs, network, runtime adapter, or schema-library dependency |
| `@callsitehq/emit`    | IR -> static artifacts such as `mcp.json` and OpenAPI                                    | Pure functions from IR to strings/objects                           |
| `@callsitehq/runtime` | Validation, dispatch, error mapping, HTTP adapters, Lambda adapter, MCP SDK registration | Importable runtime libraries; no process ownership                  |
| `@callsitehq/cli`     | `callsite build` for static artifacts                                                    | Loads config and writes files; does not host runtime                |
| `@callsitehq/zod`     | Zod 4 JSON Schema adapter and config helper                                              | Optional adapter package; keeps Zod out of core                     |

## Current Built Slice

The current implementation proves the vertical slice:

- author capabilities with `@callsitehq/core`
- lower Zod-backed capabilities through `@callsitehq/zod`
- emit `mcp.json` and OpenAPI from the same IR
- build artifacts with `callsite build`
- execute capabilities through `@callsitehq/runtime`
- host HTTP via fetch, Node, Express, or AWS Lambda adapters
- register live MCP tools on a host-owned MCP SDK server
- demonstrate the full loop in `examples/orders`

## Deferred Work

The following remain future work or explicit non-goals for the current slice:

- ChatGPT app config, Claude connector config, docs generation, and SDK
  generation.
- OpenAPI importer as an adoption wedge from existing APIs into a rough
  capability graph.
- Additional schema adapters beyond Zod.
- Hosted control plane concerns such as auth brokering, metering, remote
  observability, and managed deployment.
