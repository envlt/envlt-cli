# Code Review Notebook

Use this format for every code review response.

## Priority model (Conventional Comments style)

- `blocking`: Must be fixed before merge. Security issue, data loss risk, broken behavior, failing tests, or standards violation.
- `critical`: High-severity defect with likely production impact; should be fixed in this PR.
- `major`: Significant quality or correctness risk; fix now unless explicitly deferred with rationale.
- `minor`: Valid improvement with limited impact.
- `nit`: Style/readability polish with no behavior impact.
- `question`: Clarification request where intent is unclear.
- `suggestion`: Optional better approach.
- `praise`: Positive feedback for a strong implementation detail.

## Required output structure

1. Findings first, ordered by severity (`blocking` -> `critical` -> `major` -> `minor` -> `nit`).
2. Each finding must include:
   - Label: `[blocking]`, `[critical]`, `[major]`, `[minor]`, `[nit]`, `[question]`, `[suggestion]`, or `[praise]`
   - File reference and line: absolute path + line number
   - Why it matters (risk/impact)
   - Concrete fix
3. Keep summary short and only after findings.
4. If no issues: state explicitly `No blocking/critical/major findings.`

## Comment templates

### Blocking

`[blocking] /abs/path/file.ts:42`
`Reason: ...`
`Impact: ...`
`Fix: ...`

### Critical

`[critical] /abs/path/file.ts:42`
`Reason: ...`
`Impact: ...`
`Fix: ...`

### Major/Minor/Nit

`[major] /abs/path/file.ts:42`
`Reason: ...`
`Fix: ...`

### Question

`[question] /abs/path/file.ts:42`
`What is the expected behavior when ...?`

### Suggestion

`[suggestion] /abs/path/file.ts:42`
`Consider ... because ...`

### Praise

`[praise] /abs/path/file.ts:42`
`Good use of ...`

## Review policy for envlt

- Prioritize: security, correctness, regressions, tests, and project standards from `AGENTS.md`.
- Call out missing tests for edge cases and integration coverage.
- Mark violations of non-negotiable standards as at least `major`, and as `blocking` when they can break CI/security/release safety.
