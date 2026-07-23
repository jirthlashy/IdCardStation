# Developer Context

This is the short context file for the next developer. The README explains what the system is and how to run it; this file explains the boundaries that are easy to break while changing it.

## Repository Shape

The runnable TypeScript monorepo lives in `thai-id-intake/`.

```text
thai-id-intake/
  apps/
    backend/
    reader-agent/
    nurse-webapp/
    station-display/
  packages/
    shared-types/
```

Root-level markdown files are project notes and handoff material. They are outside the npm workspace on purpose.

## Documentation Ownership

- Update `README.md` when setup commands, environment variables, app responsibilities, or public workflow explanations change.
- Update `handoff.md` when the current deployment path, known caveats, recent work, or recommended next tests change.
- Update `PCSC_NATIVE_ADDON_TROUBLESHOOTING.md` when Node, `pcsclite`, `node-gyp`, or Windows build-tool assumptions change.
- Update `deploy-transfer/**/*.md` when scripts, bundle layout, server ports, runtime requirements, or transfer steps change.

## Core Invariants

- The backend is the routing authority. Nurse iPads and the station display must not connect directly to Kafka.
- The 5-character turn code is only for human confirmation. It is not a secret and must not be used as the private routing credential.
- Browser-private result access is bound to `requestId + requestAccessToken`.
- Kafka-internal private result topics use backend-owned `deviceSessionId`.
- Station-wide topics and station display screens must stay PII-free.
- Full card payloads, photos, addresses, citizen IDs, and laser/back numbers must only flow through backend-controlled private routing.

## Code Boundaries

- Keep app-specific behavior inside `apps/*`.
- Keep shared contracts and reusable pure logic inside `packages/*`.
- Keep domain/state-machine behavior testable without Express, Kafka, browser DOM, or card-reader hardware.
- Keep framework code thin. Route handlers should validate input and format responses; service/domain modules should own behavior.
- Keep external plumbing in `infra/`, such as Kafka clients, producers, consumers, SSE bridges, and adapters.
- Keep runtime configuration parsing and validation in `config/`.
- Keep browser API clients in `api/`, browser state helpers in `state/`, and rendering/view-model helpers in `ui/`.

## Security Notes

- Do not log citizen IDs, full addresses, photos, laser/back numbers, raw SmartCard output, secrets, or tokens.
- Validate external input at runtime: HTTP bodies, environment variables, Kafka messages, database rows, and third-party API responses.
- Treat frontend rendering as a security boundary. Escape untrusted values before inserting them into `innerHTML`, or use safe DOM text APIs.
- `scan.requests`, `station.status.*`, and `reader.status.*` should contain only safe operational state.
- `reader.card-read` and `scan-result.{deviceSessionId}` are sensitive and should stay backend-controlled.

## Change Guidelines

- Prefer the existing vanilla TypeScript style unless a framework migration is planned separately.
- Prefer responsibility-based folders such as `domain`, `services`, `routes`, `config`, `infra`, `contracts`, `components`, and `tests`.
- Avoid vague folders such as `utils`, `common`, `helpers`, `stuff`, or `misc` unless the filename narrows the responsibility clearly.
- Do not do broad structural refactors until important behavior has tests.
- Add or update tests for state machines, validation, parsers, private routing, and security-sensitive flows.

## Quality Gates

Run these from `thai-id-intake/` before merging meaningful changes:

```powershell
npm run lint
npm test
```

Use `npm run build` when the change affects packaging, TypeScript output, or deploy bundles.
