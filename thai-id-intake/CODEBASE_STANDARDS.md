# Codebase Standards

## Structure

- Keep app-specific behavior inside `apps/*`.
- Keep shared contracts and reusable pure logic inside `packages/*`.
- Prefer folder names that describe ownership: `domain`, `services`, `routes`, `config`, `infra`, `contracts`, `components`, and `tests`.
- Avoid vague folders such as `utils`, `common`, `helpers`, `stuff`, or `misc` unless the responsibility is narrowed by the filename.
- Do not do broad structural refactors until important behavior has tests.

## App Folder Conventions

- Keep app entry files at the app `src/` root: `index.ts` for services and `main.ts`, `style.css`, `vite-env.d.ts` for Vite apps.
- Use `config/` for environment parsing, app config, and runtime boundary validation schemas.
- Use `http/` for HTTP route registration and request/response formatting.
- Use `services/` for use cases that coordinate domain state, audit, Kafka, SSE, and other app behavior.
- Use `station/`, `reader/`, or similarly named domain folders for business concepts owned by one app.
- Use `infra/` for external plumbing such as Kafka clients, Kafka consumers/producers, SSE bridges, and adapters.
- Use `api/` in browser apps for backend HTTP/SSE clients.
- Use `state/` in browser apps for local state types, timers, and state helpers.
- Use `ui/` in browser apps for render functions, view models, formatting, escaping, and display-only helpers.
- Keep tests colocated beside the module they verify.

## Quality Gates

- `npm run lint` should pass before merging.
- `npm test` should pass before merging.
- `npm run build` is allowed as a verification step when appropriate.
- Add or update tests for changed behavior, especially state machines, validation, parsers, and security-sensitive flows.

## Runtime Boundaries

- Validate external input at runtime: HTTP bodies, environment variables, Kafka messages, database rows, and third-party API responses.
- Keep domain logic testable without Express, Kafka, browser DOM, or hardware.
- Keep framework code thin; route handlers should validate and format HTTP responses, while service/domain modules own behavior.

## Security And Privacy

- Do not log citizen IDs, full addresses, photos, laser/back numbers, raw SmartCard output, secrets, or tokens.
- Station-wide topics and station display views must remain PII-free.
- Full card payloads and photos must only flow through private backend-controlled routing.
- Treat frontend rendering as a security boundary. Escape untrusted values before inserting them into `innerHTML`, or use safe DOM text APIs.

## Frontend

- Keep the current vanilla TypeScript style unless a framework migration is planned separately.
- Prefer small view-model functions for display decisions so behavior can be tested without a browser.
- Keep UI text and state transitions explicit and readable.
