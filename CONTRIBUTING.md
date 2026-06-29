# Contributing

## Development

Install dependencies and run the standard checks from the repo root:

```sh
pnpm install
pnpm check
pnpm build
```

`pnpm check` runs linting, typechecking, and tests. `pnpm build` builds publishable
packages with `tsup` and runs workspace example build scripts.

## Formatting

Format files with Prettier:

```sh
pnpm format
```

Check formatting without writing changes:

```sh
pnpm format:check
```

## Publishing

Publishing is managed with Changesets. You need npm publish access to the `callsitehq` org.

Confirm npm auth and org access:

```sh
npm whoami
npm org ls callsitehq
```

Prepare and publish a release:

```sh
pnpm check
pnpm build
pnpm changeset
pnpm changeset version
pnpm install
pnpm build
pnpm changeset publish
```

After publishing, verify the package versions:

```sh
npm view @callsitehq/cli version
npm view @callsitehq/core version
npm view @callsitehq/emit version
npm view @callsitehq/runtime version
npm view @callsitehq/zod version
```
