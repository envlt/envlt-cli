# CLAUDE.md — envlt project standards

## What is envlt

CLI tool for managing encrypted environment variables in git repositories with shared secrets support between multiple services. Written in TypeScript, runs on Node.js, zero heavy dependencies.

## Non-negotiable standards

Every task, every file, every line of code must meet ALL of the following. No exceptions, no shortcuts, no "we'll fix it later".

### TypeScript

- `strict: true` in tsconfig — no escape hatches
- No `any`. Ever. Use `unknown` and narrow it properly.
- No type assertions (`as Foo`) unless accompanied by a runtime guard that proves the type
- No `@ts-ignore` or `@ts-expect-error` without a comment explaining why it is physically impossible to fix otherwise
- All function signatures fully typed: parameters, return types, generics
- Prefer `type` over `interface` for plain data shapes; use `interface` only when extension is the explicit intent
- Discriminated unions over boolean flags for state variants
- `readonly` on all data shapes that should not be mutated
- `satisfies` operator to validate object literals against types without widening

### Code quality

- Every module has a single clear responsibility
- Functions: max 30 lines. If longer — split
- No nested ternaries
- No magic numbers or strings — named constants only
- No commented-out code committed
- No dead code committed
- Imports sorted: node builtins → external packages → internal modules (enforced by eslint)

### Testing

- **Minimum 90% line + branch coverage on every module.** The CI gate will fail below this.
- Unit tests for every exported function
- Integration tests for every CLI command (spawn the real binary, assert stdout/stderr/exit code)
- Tests live next to source: `src/crypto.ts` → `src/crypto.test.ts`
- Test names follow: `describe('moduleName') > it('does X when Y')`
- No `any` in tests either
- Mocks: use only `node:test` built-in mocking or `sinon`. No jest-style magic globals.
- Every edge case that can be described in the spec must have a test
- Tests must be deterministic — no reliance on real filesystem paths, real time, or network

### Linting & formatting

- ESLint with `@typescript-eslint/recommended-type-checked` + `@typescript-eslint/strict-type-checked`
- Additional rules enforced:
  - `no-console` (use the internal `logger` module instead)
  - `no-process-exit` outside of `bin/` entry points
  - `eqeqeq: error`
  - `prefer-const: error`
  - `no-var: error`
  - `@typescript-eslint/no-floating-promises: error`
  - `@typescript-eslint/explicit-function-return-type: error`
  - `@typescript-eslint/no-unnecessary-condition: error`
- Prettier for formatting. Config: single quotes, 2 spaces, trailing commas `all`, semicolons `true`, print width 100
- `lint-staged` runs eslint + prettier on every commit (via husky)
- `tsc --noEmit` must pass with zero errors before any commit

### Security

- Encryption: AES-256-GCM only. No CBC, no ECB, no deprecated algorithms
- Every encrypt call uses a freshly generated random IV (12 bytes). Never reuse IVs.
- Authentication tags always verified on decrypt — any tamper = hard error
- Master keys stored in `~/.envlt/keys/` with `chmod 600`. Any other permission = refuse to run.
- Key material never logged, never written to tmp files in plaintext
- Tmp files (used in `edit` command) written with `chmod 600`, deleted in `finally` blocks
- No `eval`, no `Function()`, no dynamic `require()` with user-supplied strings
- All user-supplied paths sanitized with `path.resolve` + prefix check before any fs operation
- Child processes in `use` command spawned with explicit `env` — never inherit the full parent env implicitly
- Dependencies: locked versions in `package-lock.json`, no `^` or `~` for runtime deps. Audit on every CI run.

### Error handling

- No swallowed errors. Every `catch` either re-throws, returns a typed `Result`, or logs + exits with non-zero code
- Use a `Result<T, E>` pattern (thin custom type, no library) for recoverable errors
- Unrecoverable errors use a typed `AppError` class with a `code` enum — never throw bare `new Error('string')`
- Exit codes are named constants, never raw numbers scattered in code

### Git hygiene

- Commits follow Conventional Commits: `feat:`, `fix:`, `test:`, `chore:`, `docs:`
- No commit should leave tests failing or `tsc` erroring
- Each task in `tasks/` corresponds to one logical PR

### Dependencies policy

- Allowed external runtime deps: `commander`, `inquirer`, `chalk`
- Everything else: Node.js built-ins only (`node:crypto`, `node:fs`, `node:child_process`, etc.)
- Dev deps: `typescript`, `eslint`, `@typescript-eslint/*`, `prettier`, `lint-staged`, `husky`, `c8` (coverage), `sinon`
- Adding any new runtime dependency requires explicit justification in the PR description

### File structure

```
envlt/
├── bin/
│   └── envlt.ts            # CLI entry point only — no logic
├── src/
│   ├── commands/           # one file per command
│   ├── storage/            # storage adapter abstraction + implementations
│   ├── shared/             # shared secrets resolution
│   ├── validation/         # key validation, levenshtein, pairs
│   ├── hooks/              # git hook installer
│   ├── ci/                 # CI config generators
│   ├── crypto.ts
│   ├── keystore.ts
│   ├── envfile.ts
│   ├── manifest.ts
│   ├── config.ts
│   ├── result.ts           # Result<T,E> type + helpers
│   ├── errors.ts           # AppError, ErrorCode enum
│   ├── logger.ts           # structured output, respects --quiet
│   └── constants.ts        # EXIT_CODES, file name patterns, etc.
├── tasks/                  # spec-driven task files for AI agents
├── tests/
│   └── integration/        # full CLI integration tests
├── CLAUDE.md
├── package.json
├── tsconfig.json
├── .eslintrc.cjs
├── .prettierrc
└── .gitignore
```

## Definition of Done (global)

A task is NOT done until:

- [ ] All specified files exist with correct exports
- [ ] `tsc --noEmit` exits 0
- [ ] `eslint .` exits 0
- [ ] `prettier --check .` exits 0
- [ ] `c8 npm test` shows ≥90% lines and branches on all touched files
- [ ] All integration tests for new commands pass (real binary, real spawn)
- [ ] No secrets, keys, or plaintext env values appear in any test fixture or snapshot
- [ ] `git log --oneline` shows conventional commit messages
