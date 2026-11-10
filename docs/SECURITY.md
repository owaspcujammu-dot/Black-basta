# Security notes — Black Basta

How the platform defends itself, and how each defence is checked. "Test" entries name the
automated test file in `backend/tests/` (run with `npm test`).

## Threat model

Participants are skilled, motivated, and explicitly told to hack — just not the platform. Assume
every participant will probe the scoreboard, the flag checker and the admin panel. The assets to
protect are, in order: **flags**, **score integrity**, **the admin account**, **other participants'
accounts**, and **availability during the event**.

## Checklist

| Risk | Defence | Verified by |
|---|---|---|
| **Flag exposure** | Flags are stored only as `SHA-256(salt:flag)`. Every query that feeds an API response uses an explicit `select` without `flagHash`/`flagSalt`. Correct submissions are written to the log as `[redacted: correct flag]`. The frontend bundle contains no flags. | `flags.test.ts` — *no participant or admin API response contains a flag, hash or salt*; *never stores a correct flag in the submissions log* |
| **Flag enumeration / partial-match oracle** | A wrong flag always returns the same body, whether it is close or not. Comparison is constant-time on hashes. The hash is computed even when the format is wrong. | `flags.test.ts` — *gives the same answer for a near-miss as for a total miss* |
| **Flag brute force** | Per-account limits: 12 submissions/min overall and 6/min per challenge (configurable). A throttled request is rejected before the flag is evaluated. | `rate-limit.test.ts` |
| **Rate-limit bypass** | Limits are keyed by account, not by a client-supplied header. `X-Forwarded-For` is only trusted for the configured number of proxy hops. | `rate-limit.test.ts` — *cannot be bypassed by spoofing X-Forwarded-For* |
| **SQL injection** | All database access goes through Prisma (parameterised). The two raw queries are static tagged templates with no user input. Route ids are validated as integers before use. | `security.test.ts` — injection payloads in login, search, flags and ids |
| **XSS** | React escapes all rendered values; no `dangerouslySetInnerHTML`; descriptions and announcements are rendered as text. Usernames are restricted to `[A-Za-z0-9_.-]`. The API serves only JSON with `nosniff`; nginx sends a CSP with `script-src 'self'`. | `security.test.ts` — *returns stored markup as inert JSON*; *rejects script tags in usernames* |
| **CSRF** | Session cookie is `SameSite=Strict`; state-changing requests must carry an allowed `Origin` and an `X-CSRF-Token` header equal to the `kop_csrf` cookie. CORS allows only `FRONTEND_URL`. | `security.test.ts` — CSRF section |
| **Broken authentication** | bcrypt hashes; identical error for unknown user and wrong password, with a dummy hash compare to equalise timing; HS256 only (`alg: none` rejected); sessions carry a token version that is checked against the database, so disabling an account or resetting a password revokes sessions immediately; login failures are rate-limited per IP + account. | `auth.test.ts`, `authorization.test.ts` — forged / unsigned / tampered tokens |
| **Broken authorization** | Every `/api/admin/*` route passes `requireAuth` then `requireAdmin`, which reads the role from the database — a token claiming `role: admin` for a participant is refused. Registration ignores `role`, `score` and other privileged fields. | `authorization.test.ts`, `security.test.ts` — mass assignment |
| **IDOR** | Participant endpoints take no user id: `/profile` and `/auth/me` always act on the session's user. Attachments are looked up by id **and** challenge id, and only for enabled challenges. Other users' submissions are admin-only. | `security.test.ts` — access control section |
| **Path traversal** | Download paths are built from the numeric challenge id and a stored random filename from the database — never from request text. The file is served with `root` pinned to the challenge directory. | `security.test.ts` — *blocks path traversal in the download URL* |
| **File upload abuse** | Admin-only; 50 MB and 5-file limits; stored as `uploads/challenge_NNN/<16 hex>.<ext>` where the extension comes from an allow-list (anything else becomes `.bin`); display names are sanitised; files are never executed or served inline (`Content-Disposition: attachment`, `application/octet-stream`, `nosniff`). The uploads directory is not web-served. | `security.test.ts` — uploads section |
| **Participant-limit race** | Registration runs in a transaction that takes a row lock on the event record before counting, so simultaneous sign-ups cannot both take the last slot. | `participant-limit.test.ts` — 12 concurrent registrations for 5 slots |
| **Double scoring** | `Solve` has a unique `(userId, challengeId)` index and is inserted with `ON CONFLICT DO NOTHING` inside the scoring transaction; first blood uses a unique `challengeId` index the same way. | `flags.test.ts` — *awards exactly once when the same flag is submitted concurrently* |
| **Information leakage** | Unknown errors return a generic `SHIPWRECK` message; stack traces only go to the server log. `X-Powered-By` is removed. | `security.test.ts` — HTTP hardening |
| **Secrets** | No credential in the repository. `JWT_SECRET` and `ADMIN_PASSWORD` come from the environment; production refuses placeholder values. Demo mode cannot run in production. | config checks at start-up |

## Manual checks before an event

Automated tests cover the application. These cover the deployment:

1. **HTTPS** — `curl -I https://your-domain` returns 200 with `Strict-Transport-Security`; plain
   HTTP redirects.
2. **Cookie flags** — in the browser's storage inspector, `kop_session` shows `HttpOnly`, `Secure`
   and `SameSite=Strict`.
3. **Closed ports** — from another machine, `nmap -p 5000,5173,5432 your-server` shows them
   closed or filtered.
4. **Admin panel** — log in as a participant and open `/admin`: you get *403 — Marine Territory*,
   and `curl` to `/api/admin/dashboard` with the participant cookie returns 403.
5. **Flags** — open the browser's network tab on the challenges page and search the responses
   for your flag text: nothing.
6. **Rate limit** — submit seven wrong flags to one challenge within a minute: the seventh is
   refused with 429.
7. **Participant limit** — set `MAX_PARTICIPANTS` to a small number on staging and confirm the
   next registration shows *"The Grand Line is Full!"*.
8. **Sample data** — `SEED_DEMO_CHALLENGES` is false, no sample challenge exists, and no `demo` account exists.

## Known limits

- Rate limits, caches and the live-update hub are in memory: run **one** backend instance.
- There is no email verification or self-service password reset; admins reset passwords.
- A participant can register more than one account if slots are free. The 110-slot cap, unique
  emails and the organizers' discretion (rule 10) are the control.
- Attachments are not virus-scanned. Only admins can upload.

## Reporting

If you find a vulnerability in the platform during an event, tell the organizers privately
instead of exploiting it — see rules 3 and 6.
