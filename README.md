# envlt

Encrypted environment variable manager for Git repositories.

`envlt` helps teams keep `.env` values encrypted in-repo, validate required variables, and run
processes with decrypted environment values at runtime.

## Why envlt

- Encrypts env files with AES-256-GCM.
- Uses a local key store with strict file permissions.
- Supports per-environment encrypted files.
- Adds guardrails for key naming and required variable checks.
- Supports shared encrypted entries from GitHub repos.

## Install

```bash
npm install -g envlt
```

Or run with `npx`:

```bash
npx envlt --help
```

## Quick Start

Initialize in your project:

```bash
envlt init
```

This creates:

- `envlt.config.json`
- Encrypted env files for selected environments
- A generated key in `~/.envlt/keys/`
- `.gitignore` additions for local plaintext/temp files

Set variables:

```bash
envlt set DATABASE_URL=postgres://localhost:5432/app --env development
envlt set API_KEY=secret --env production
```

Declare expected variables:

```bash
envlt declare DATABASE_URL --description "Primary DB connection string" --required
envlt declare PUBLIC_BASE_URL --description "Public app URL" --no-secret
```

Validate config/env completeness:

```bash
envlt check --env development
envlt check --env production --strict
```

Run commands with decrypted env:

```bash
envlt use --env development -- node server.js
envlt use --env production --strict-shared -- node dist/server.js
```

Edit encrypted env in your editor:

```bash
envlt edit --env development
```

## Core Commands

- `envlt init`
- `envlt set <KEY=VALUE...> [--env <name>] [--key-id <id>]`
- `envlt declare <KEY> --description <text> [--env <name>] [--required|--no-required] [--secret|--no-secret]`
- `envlt check [--env <name>] [--strict] [--key-id <id>]`
- `envlt edit [--env <name>] [--key-id <id>] [--editor <command>]`
- `envlt use [--env <name>] [--key-id <id>] [--passthrough] [--strict-shared] -- <command ...>`
- `envlt shared clear-cache [--repo <org/repo>]`
- `envlt hooks install [--force]`
- `envlt hooks uninstall`
- `envlt hooks status`

## Config

Minimal `envlt.config.json`:

```json
{
  "appName": "my-app",
  "envs": ["development", "staging", "production"],
  "keyId": "my-app-12345678"
}
```

With shared entries:

```json
{
  "appName": "my-app",
  "envs": ["development", "staging", "production"],
  "keyId": "my-app-12345678",
  "extends": [
    "github:my-org/shared-secrets/payments/base",
    "github:my-org/shared-secrets/analytics/core"
  ]
}
```

`extends` entries are resolved from a local cache and merged in order. Later entries override
earlier ones.

## Security Notes

- Encryption algorithm: AES-256-GCM.
- Master keys are stored in `~/.envlt/keys/`.
- Key file permissions are validated and enforced.
- Temporary plaintext files used by `edit` are protected and cleaned up.
- `use` can run with isolated env (`--passthrough` is opt-in).

## Shared Secrets Cache

Shared repos are cached under:

`~/.envlt/cache`

Clear one repo cache:

```bash
envlt shared clear-cache --repo my-org/shared-secrets
```

Clear all cache:

```bash
envlt shared clear-cache
```

## Git Hooks

Install pre-commit validation hook:

```bash
envlt hooks install
```

Force install/update if a hook already exists:

```bash
envlt hooks install --force
```

## Development

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run test:coverage:ci
npm run build
```

## License

MIT
