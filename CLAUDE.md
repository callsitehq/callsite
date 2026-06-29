<!-- Generated from AGENTS.md. Do not edit directly. Run pnpm sync:agent-docs. -->

# AGENTS.md

## Project

Callsite is a TypeScript pnpm monorepo for importable libraries under the
`@callsitehq/*` npm scope. The product and CLI are named Callsite; package names
use the `@callsitehq` org scope.

Read `docs/design-doc.md` before making architecture-level changes.

## Commands

- Install dependencies: `pnpm install`
- Run checks: `pnpm check`
- Build packages: `pnpm build`
- Format files: `pnpm format`
- Check formatting: `pnpm format:check`

`pnpm check` runs linting, typechecking, and tests. `pnpm build` builds
publishable packages with `tsup` and runs workspace example build scripts.

## Package Layout

- `packages/core`: authoring API, IR types, and validation boundary.
- `packages/emit`: pure renderers from IR to static artifacts.
- `packages/runtime`: `Request -> Response` runtime dispatch engine.
- `packages/zod`: Zod adapter for capability config files.
- `packages/cli`: `callsite` command for generated outputs.
- `examples/orders`: private end-to-end example covering capabilities, CLI
  generation, emitted artifacts, and runtime execution.

## Conventions

- Use `pnpm`; do not add npm or yarn lockfiles.
- Use `tsup` for package builds.
- Use `vitest` for tests.
- Keep package boundaries explicit and importable.
- Add focused tests for public package behavior.
- Keep public package READMEs short and package-specific.
- Put maintainer workflows in `CONTRIBUTING.md`, not the top-level README.

## Publishing

Publishing uses Changesets. See `CONTRIBUTING.md` for the release process.
