# ☠ Black Basta — Cybersecurity CTF Platform

> *"The Grand Line awaits. Only the strongest pirates will claim the One Piece."*

A complete, self-hosted jeopardy-style Capture The Flag platform for up to **110 participants**:
registration with a hard participant cap, challenges with attachments and paid hints, server-side
flag validation (`NIKA{...}`), a live leaderboard, first bloods, achievements, announcements, event
controls and a full admin panel — in a blood-red and black pirate theme.

| | |
|---|---|
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS, Framer Motion, Lucide icons |
| **Backend** | Node.js, Express 5, TypeScript, Zod, Helmet, express-rate-limit |
| **Database** | PostgreSQL 16 with Prisma ORM |
| **Auth** | bcrypt password hashes, JWT session in an HTTP-only SameSite=Strict cookie, CSRF double-submit token |
| **Real time** | Server-Sent Events (leaderboard, event state, announcements, releases, participant count) |
| **Deployment** | Docker Compose (`frontend`, `backend`, `postgres`) |

---

## Contents

1. [Try it in two commands (demo mode)](#1-try-it-in-two-commands-demo-mode)
2. [Local development](#2-local-development)
3. [One-command Docker](#3-one-command-docker)
4. [Environment variables](#4-environment-variables)
5. [Admin credentials](#5-admin-credentials)
6. [Running an event](#6-running-an-event)
7. [Theme and brand images](#7-theme-and-brand-images)
8. [Tests](#8-tests)
9. [Security](#9-security)
10. [Production deployment (Linux VPS)](#10-production-deployment-linux-vps)
11. [Production checklist](#11-production-checklist)
12. [API reference](#12-api-reference)
13. [Project structure](#13-project-structure)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Try it in two commands (demo mode)

Needs only **Node.js 20+** — no Docker, no database server. Demo mode runs on an embedded
PostgreSQL (PGlite) stored outside the project, in your local app-data folder
(`%LOCALAPPDATA%lack-bastademo-db` on Windows, `~/.local/share/black-basta/demo-db` elsewhere).
It is kept out of the project on purpose: cloud-sync folders such as OneDrive turn files into
placeholders the embedded database cannot open.

```bash
npm install
npm run demo
```

Open **http://localhost:5173**. The API terminal prints the logins generated for this run:

```
  ┌──────────────── DEMO MODE ────────────────
  │ admin        admin / <generated password>
  │ participant  demo / <generated password>
  │ No sample content: create challenges in the admin panel, then press Start CTF.
  └───────────────────────────────────────────
```

Demo mode creates **no dummy content**: just an admin and a `demo` participant to log in with. The
platform starts exactly as a real one does — no challenges, no announcements, an empty leaderboard,
and the event **UPCOMING**. Log in as admin, create a challenge, press **START CTF**, then use the
`demo` login (or register) to test wrong and correct flags, hints, the leaderboard, first blood,
announcements and pausing/ending the event.

Want something to click on straight away? Set `SEED_DEMO_CHALLENGES=true` in `.env` before the
first start to get eight sample challenges (each description shows its sample flag).

- Passwords are random per run. To fix them, set `ADMIN_PASSWORD` and `DEMO_PASSWORD` in `.env`.
- To start over, stop the server and delete that `demo-db` folder (the path is printed when demo mode starts).
- To put it somewhere else, set `DEMO_DATABASE_URL=pglite://<directory>`.
- Demo mode **refuses to start** when `NODE_ENV=production`, and the Docker stack forces it off.

---

## 2. Local development

### Requirements

```
Node.js 20+
npm
Docker
Docker Compose
Git
```

### Clone and install

```bash
git clone <repository-url>
cd king-of-pirates
npm install
```

`npm install` at the root installs both workspaces (`backend` and `frontend`).

### Configure the environment

```bash
cp .env.example .env
```

Then edit `.env` and set at least `JWT_SECRET` and `ADMIN_PASSWORD` (see
[Environment variables](#4-environment-variables)).

### Start the database

```bash
docker compose up -d postgres
```

### Prisma

```bash
npx prisma generate
npx prisma migrate dev
npx prisma db seed
```

`migrate dev` applies the migrations in `backend/prisma/migrations`. The seed creates the event
row, the ten categories, the achievements and the admin account (from `ADMIN_USERNAME` /
`ADMIN_PASSWORD`). With `SEED_DEMO_CHALLENGES=true` it also adds eight sample challenges when
there are none yet.

### Start the backend

```bash
cd backend
npm run dev
```

### Start the frontend

```bash
cd frontend
npm run dev
```

The website is then available at **http://localhost:5173** and the API at **http://localhost:5000**.
The Vite dev server proxies `/api` to the backend, so the browser only ever talks to one origin.

`npm run dev` at the repository root starts both together.

---

## 3. One-command Docker

```bash
cp .env.example .env        # then set JWT_SECRET and ADMIN_PASSWORD
docker compose up --build
```

This builds and starts the entire platform:

| Service | What it is | Address |
|---|---|---|
| `frontend` | nginx serving the React build and proxying `/api` | http://localhost:5173 |
| `backend` | Express API (runs migrations and the seed on start) | http://localhost:5000 |
| `postgres` | PostgreSQL 16, data in the `pgdata` volume | localhost:5432 |

Add `-d` to run in the background (`docker compose up -d`). All three services have health checks;
the frontend waits for a healthy backend, which waits for a healthy database.

Compose will stop with a clear message if `JWT_SECRET` or `ADMIN_PASSWORD` is missing, and the
backend refuses to boot in production with a placeholder or short `JWT_SECRET`.

> Ports are published on `127.0.0.1` only. For an isolated LAN event without a reverse proxy, set
> `BIND_ADDRESS=0.0.0.0` in `.env`. For anything internet-facing, follow
> [section 10](#10-production-deployment-linux-vps).

---

## 4. Environment variables

All configuration lives in `.env` at the repository root (never committed).

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — (required) | PostgreSQL connection string for a backend running on the host. Under Docker Compose the backend builds its own from `POSTGRES_PASSWORD`. |
| `POSTGRES_PASSWORD` | `postgres` | Password of the Compose PostgreSQL container. Change it for production. |
| `JWT_SECRET` | — (required) | Signs session tokens. ≥ 32 random characters. Production refuses `CHANGE_ME` or anything shorter. |
| `ADMIN_SECRETS_KEY` | `JWT_SECRET` | Encrypts the admin-viewable copies of flags and organizer-set team passwords. Set it to keep them readable if you ever rotate `JWT_SECRET`. |
| `ADMIN_USERNAME` | `admin` | Admin login name. |
| `ADMIN_PASSWORD` | — | Admin password. **No default**: while empty or `CHANGE_ME`, no admin account is created. |
| `ADMIN_EMAIL` | `admin@blackbasta.local` | Admin email. |
| `PORT` | `5000` | Backend port. |
| `FRONTEND_URL` | `http://localhost:5173` | Public site URL(s), comma-separated. Used for CORS and the CSRF origin check. |
| `COOKIE_SECURE` | `true` in production | Send the session cookie over HTTPS only. Compose defaults it to `false`; set `true` once HTTPS works. |
| `TRUST_PROXY` | `0` | Reverse-proxy hops in front of the backend (for correct client IPs). Compose uses `TRUST_PROXY_HOPS` (default `1`; use `2` behind a host-level nginx). |
| `EVENT_NAME` | `Black Basta` | Event name. |
| `MAX_PARTICIPANTS` | `110` | Hard cap on participant accounts, enforced server-side. |
| `FLAG_PREFIX` | `NIKA` | Flag format prefix: `NIKA{...}`. |
| `FIRST_BLOOD_BONUS` | `0` | Bonus points for the first solver of each challenge. |
| `EVENT_START_AT`, `EVENT_END_AT` | — | Optional ISO-8601 schedule used when the event is first created (editable in the admin panel). |
| `SEED_DEMO_CHALLENGES` | `false` | Opt-in: seed eight sample challenges when none exist (created **disabled** in production). Their flags are public. |
| `DEMO_MODE` | `false` | Demo mode ([section 1](#1-try-it-in-two-commands-demo-mode)). Rejected in production. |
| `DEMO_PASSWORD` | random | Password of the `demo` participant in demo mode. |
| `RATE_LIMIT_ENABLED` | `true` | Master switch for rate limiting (tests turn it off). |
| `SUBMIT_LIMIT_PER_MIN` | `10` | Flag submissions per player per minute, all challenges (each team member has their own allowance). |
| `SUBMIT_LIMIT_PER_CHALLENGE` | `10` | Flag submissions per player per challenge per minute. |
| `BCRYPT_ROUNDS` | `12` | bcrypt cost factor. |
| `SESSION_HOURS` | `12` | Session lifetime. |
| `DB_POOL_MAX` | `30` | PostgreSQL connection pool size (PostgreSQL allows 100 by default). |
| `UV_THREADPOOL_SIZE` | `8` (Docker) | Threads for password hashing; more threads make a mass login at the start faster. |
| `SCOREBOARD_PUSH_MS` | `2000` | Live scoreboard pushes are sent at most this often (each push goes to every open browser). |
| `UPLOAD_DIR` | `uploads` | Where attachments are stored. |
| `MAX_UPLOAD_MB` | `50` | Maximum attachment size. |
| `VITE_API_PROXY` | `http://localhost:5000` | Dev only: where Vite forwards `/api`. |

---

## 5. Admin credentials

No credential is hardcoded anywhere — not in source, the Dockerfiles, the frontend, or this README.

```
ADMIN_USERNAME=admin
ADMIN_PASSWORD=CHANGE_ME
```

**Organizers must change `ADMIN_PASSWORD` before deployment.** While it is `CHANGE_ME` (or empty)
the seed creates no admin account at all. The environment variable is the source of truth: change
it and re-run the seed (or restart the Docker backend) and the admin password is updated and every
existing admin session is revoked.

The admin panel is at **`/admin`**. Admins never see participant passwords — they can only generate
a new temporary password, shown once.

---

## 6. Running an event

1. **Before the event** — log in as admin, open **Admin → Challenges**, and create your challenges
   (title, description, category, difficulty, points, flag, hints, attachments). The platform
   starts with none.
2. **Schedule** — on **Admin → Dashboard**, set the scheduled start (drives the public countdown)
   and the scheduled end (the event ends automatically at that time).
3. **Registration** — participants register at `/register` and get a number (`Pirate #047 / 110`).
   The 111th registration is refused with *"The Grand Line is Full!"*. While the event is
   **UPCOMING**, challenges are hidden from participants.
4. **Start** — press **START CTF**. Challenges appear for everyone instantly.
5. **During** — publish announcements, release more challenges (enable them), watch submissions.
   Every logged-in pirate gets these instantly as a toast and in the **notification bell** in the
   header (announcements, new challenges, first bloods and event state changes, with an unread count).
   **PAUSE CTF** keeps the platform visible but blocks flag submission.
6. **End** — **END CTF** closes submission, keeps the leaderboard visible, and crowns the top
   pirate with the *Pirate King* achievement.

### Scoring

| Difficulty | Default points |
|---|---|
| Easy | 100 |
| Medium | 200 |
| Hard | 300 |
| Insane | 500 |

- Points are set per challenge; a challenge awards points **once** per participant.
- **Ranking:** higher score ranks higher. On a tie, whoever **reached that score earlier** ranks
  higher. Every score change is recorded with its timestamp (`ScoreEvent`).
- **First blood:** the first solver of each challenge is recorded and shown on the challenge;
  `FIRST_BLOOD_BONUS` optionally adds points (e.g. 300 + 50 = 350).
- **Hints** can cost points; the participant confirms before paying, and is charged once.
- Editing a challenge's points, or deleting a challenge, re-scores everyone automatically.
- Scoring is static. Dynamic (decaying) scoring is not implemented.

### Things worth knowing

- **Flags are checked against salted SHA-256 hashes.** Admins can still view them: Admin →
  Challenges → **Flags** shows the flag and extra accepted flags from an AES-256-GCM encrypted copy
  whose key (`ADMIN_SECRETS_KEY`, default `JWT_SECRET`) lives only in the environment, never in the
  database. Flags saved before this feature have no copy — re-enter them once in Edit. Leaving the
  flag field blank when editing keeps the current flag.
- **Team passwords** set by organizers (Add teams, or Password → set/generate) are viewable the same
  way under Admin → Pirates → **Password**. Passwords that teams chose themselves at sign-up, and
  admin passwords, are never viewable. Changing `ADMIN_SECRETS_KEY`/`JWT_SECRET` makes the stored
  copies unreadable (logins and flag checks keep working).
- Admins can submit flags to test a challenge; nothing is recorded and admins never appear on the
  leaderboard.
- The backend is designed to run as a **single instance** (in-memory rate limits, caches and
  live-update hub). That comfortably covers 110 participants; do not run multiple replicas.

---

## 7. Theme and brand images

The interface is **blood red on black**. Colours are defined once in
`frontend/tailwind.config.js` (the `accent` scale is the brand red) and `frontend/src/index.css`.

The logo and the landing-page picture are image slots. Put files in
`frontend/public/brand/` and they are used automatically:

| File | Used for |
|---|---|
| `emblem.png` (or `.svg`, `.webp`, `.jpg`) | Logo in the header, landing hero and login page. Square, ≥ 512 px. |
| `ship.png` (or `.webp`, `.jpg`) | Ship picture on the landing page. Landscape, ≥ 1200 px wide. |

Until those files exist, the original skull-and-crossbones and treasure chest drawn for this
project are shown. All built-in artwork is original.

> Only use artwork you have the right to use. Official One Piece artwork (for example the Straw
> Hat emblem or the Thousand Sunny) belongs to its rights holders — use it only if your event has
> permission.

---

## 8. Tests

```bash
npm test
```

124 backend tests run against a real PostgreSQL engine **in memory** (PGlite) — no database server
or Docker needed, and nothing touches your development database.

| File | Covers |
|---|---|
| `auth.test.ts` | Registration, login, invalid credentials, duplicate username/email, weak passwords, logout, disabled accounts, cookie flags |
| `participant-limit.test.ts` | 109 → allowed, 110 → allowed, 111 → rejected; admins unaffected; a 12-way registration race never exceeds the cap |
| `flags.test.ts` | Correct flag, incorrect flag, wrong prefix, duplicate solve, concurrent duplicate, first blood, no partial-match feedback, flags never in any response, hints, event-state gating |
| `authorization.test.ts` | Unauthenticated → no dashboard; participant → no admin; admin → admin; forged / `alg:none` / role-lying tokens; admin CRUD; event controls |
| `scoreboard.test.ts` | Score calculation, tie-breaking by time reached, re-scoring after admin edits, live SSE push |
| `security.test.ts` | CSRF, SQL injection, XSS handling, mass assignment, headers, path traversal, upload abuse, IDOR |
| `rate-limit.test.ts` | Flag brute-force throttling, per-account limits, `X-Forwarded-For` spoofing, login lockout |

Other checks:

```bash
npm run typecheck     # TypeScript, both workspaces
npm run build         # production builds
```

### Load test (~110 concurrent users)

Against a running **demo or staging** instance (it creates real accounts and uses participant slots):

```bash
npm run loadtest -- --url http://localhost:5000 --users 110 --rounds 5
```

Each simulated pirate registers, holds a live-update stream open, and loops through listing
challenges, opening one, submitting a wrong flag and reading the leaderboard. It prints per-endpoint
median / p95 / max latency and any errors.

---

## 9. Security

Full notes, including how each item was tested, are in **[docs/SECURITY.md](docs/SECURITY.md)**.

- **Flags never leave the server.** Stored as salted hashes, compared in constant time, excluded
  from every API response (including admin ones), and redacted from the submissions log.
- **Passwords:** bcrypt; never returned by any endpoint; admins can only reset, not read.
- **Sessions:** JWT in an HTTP-only, SameSite=Strict cookie; revocable (disable / reset).
- **CSRF:** SameSite cookie + Origin check + double-submit token on every state-changing request.
- **Authorization:** every admin route checks the role stored in the database, not the token.
- **Input:** Zod validation on every body and query; Prisma parameterises all SQL.
- **XSS:** React escapes all output; user content is rendered as text, never HTML; strict CSP.
- **Rate limiting:** per account (per IP when anonymous) on the API, login, registration and flag
  submission — sized for a room of players behind one NAT address.
- **Uploads:** admin-only, random on-disk names, stored outside the web root, served only to
  authenticated users as forced downloads.

---

## 10. Production deployment (Linux VPS)

Layout for **Ubuntu 22.04 / 24.04**. A 2 vCPU / 2–4 GB server is ample for 110 participants.

```
                    INTERNET
                       │
                       ▼
                 ┌───────────┐
                 │   NGINX   │   host-level, ports 80/443
                 │ HTTPS/TLS │
                 └─────┬─────┘
                       │ 127.0.0.1:5173
          ┌────────────┴────────────┐
          ▼                         ▼
    ┌───────────┐   /api      ┌───────────┐
    │ Frontend  │────────────▶│  Backend  │
    │   React   │             │  Express  │
    └───────────┘             └─────┬─────┘
                                    │
                              ┌─────▼─────┐
                              │ PostgreSQL│
                              └───────────┘
```

Only nginx is exposed. The three containers listen on `127.0.0.1`.

### 10.1 Domain

Create a DNS **A record** (e.g. `ctf.example.com`) pointing at the server's public IP.

### 10.2 Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Do **not** open 5000, 5173 or 5432. (Docker publishes ports past `ufw`; that is why the compose
file binds them to `127.0.0.1`.)

### 10.3 Docker and Docker Compose

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER     # log out and back in afterwards
docker compose version
```

### 10.4 Get the code and configure it

```bash
git clone <repository-url> king-of-pirates
cd king-of-pirates
cp .env.example .env
nano .env
```

Set at least:

```ini
JWT_SECRET=<48+ random bytes — see the command in .env.example>
ADMIN_PASSWORD=<a strong, unique password>
POSTGRES_PASSWORD=<a strong, unique password>
FRONTEND_URL=https://ctf.example.com
COOKIE_SECURE=true
TRUST_PROXY_HOPS=2
DEMO_MODE=false
```

### 10.5 Start the stack (PostgreSQL included)

```bash
docker compose up -d --build
docker compose ps            # all three should be "healthy"
docker compose logs -f backend
```

PostgreSQL runs in the `postgres` container with its data in the `pgdata` volume; migrations and
the seed run automatically when the backend starts. To use a managed PostgreSQL instead, remove the
`postgres` service and set the backend's `DATABASE_URL` to it.

### 10.6 Nginx

```bash
sudo apt update && sudo apt install -y nginx
sudo nano /etc/nginx/sites-available/king-of-pirates
```

```nginx
server {
    listen 80;
    server_name ctf.example.com;

    client_max_body_size 55m;

    # Live updates (Server-Sent Events) must not be buffered.
    location /api/stream {
        proxy_pass http://127.0.0.1:5173;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 1h;
    }

    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/king-of-pirates /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 10.7 HTTPS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d ctf.example.com
```

Certbot rewrites the server block for TLS, adds the HTTP → HTTPS redirect and renews automatically.
Afterwards confirm `COOKIE_SECURE=true` and `FRONTEND_URL=https://…` in `.env`, then
`docker compose up -d`. Add HSTS once you are sure HTTPS works:

```nginx
add_header Strict-Transport-Security "max-age=31536000" always;
```

### 10.8 Backups

Backups are automatic: the `backup` service in `docker-compose.yml` (script: `docker/backup.sh`)
saves a full copy of the site every **15 minutes** into `./backups` next to `docker-compose.yml`:

```text
backups/
  LATEST.txt                      name of the newest backup
  2026-11-26_221500/
    database.dump                 everything: teams, players, challenges, flags (hashed), solves, hints, sessions…
    scoreboard.csv  teams.csv  solves.csv  submissions.csv  challenges.csv     open in Excel / Google Sheets
  uploads/
    uploads-2026-11-26_221500.tar.gz   challenge files (saved again only when they change; newest 5 kept)
```

The newest 200 backups are kept (about two days at 15 minutes). Settings in `.env`:
`BACKUP_INTERVAL_MINUTES`, `BACKUP_KEEP`, `BACKUP_DIR` and `BACKUP_TIMEZONE` (folder names and log times).
Check it is working with `docker compose logs backup`. **Copy the `backups` folder off the machine
regularly** (on a server, e.g. with `rsync` or `scp` from your laptop): a backup on the same disk does not
survive losing that disk.

**Restore** (replaces the current data with the backup):

```bash
docker compose stop backend backup
docker compose exec -T postgres pg_restore -U postgres -d king_of_pirates --clean --if-exists --no-owner < backups/2026-11-26_221500/database.dump
# Challenge files, if they were lost too:
docker run --rm -v black-basta_uploads:/data -v "$PWD/backups/uploads":/b alpine sh -c "tar xzf /b/uploads-2026-11-26_221500.tar.gz -C /data"
docker compose start backend backup
```

To check a backup without touching the live data, restore it into a scratch database instead
(`createdb restore_test`, then `pg_restore -d restore_test …`, and `dropdb restore_test` afterwards).

### 10.9 Upload storage

Attachments live in the `uploads` Docker volume, mounted at `/app/uploads`. To keep them on a
specific disk, replace the volume with a bind mount (`- /srv/kop-uploads:/app/uploads`) owned by
UID 1000 (the container's `node` user).

### 10.10 Updating

```bash
git pull
docker compose up -d --build
```

---

## 11. Production checklist

```
[ ] Change JWT_SECRET
[ ] Change admin password
[ ] Configure DATABASE_URL
[ ] Configure domain
[ ] Configure HTTPS
[ ] Configure firewall
[ ] Disable demo mode
[ ] Backups running (`docker compose logs backup`) and the `backups` folder copied off the server
[ ] Configure upload storage
[ ] Test registration
[ ] Test login
[ ] Test flag submission
[ ] Test scoreboard
[ ] Test admin panel
[ ] Verify participant limit
[ ] Load test with approximately 110 concurrent users
```

Also recommended:

```
[ ] Change POSTGRES_PASSWORD
[ ] Set COOKIE_SECURE=true and FRONTEND_URL to the https:// domain
[ ] Leave SEED_DEMO_CHALLENGES=false (the sample challenges have public flags)
[ ] Keep your own list of flags too (the panel can show them, but not after a JWT_SECRET change)
[ ] Set TRUST_PROXY_HOPS=2 behind a host-level nginx
[ ] Confirm the brand images in frontend/public/brand are ones you may use
```

---

## 12. API reference

All routes are under `/api`. Errors are `{ "error": { "code", "message", "details?" } }`.
State-changing requests need the `X-CSRF-Token` header (value from `GET /api/auth/csrf`).

### Public

| Method | Path | |
|---|---|---|
| GET | `/health` | Liveness + database check |
| GET | `/event` | Event name, state, schedule, participant count, flag format |
| GET | `/scoreboard` | Leaderboard |
| GET | `/stream` | Server-Sent Events: `event`, `scoreboard`, `participants`; plus `announcement`, `challenge`, `solve` for logged-in clients |
| GET | `/auth/csrf` | Issue the CSRF token |
| POST | `/auth/register` | Register (enforces the participant cap) |
| POST | `/auth/login` | Log in with username or email |
| POST | `/auth/logout` | Log out |

### Authenticated

| Method | Path | |
|---|---|---|
| GET | `/auth/me` | Current user with rank |
| GET | `/profile` | Own profile, solves and achievements |
| GET | `/announcements` | Announcements |
| GET | `/categories` | Categories |
| GET | `/challenges` | Challenge cards (hidden while UPCOMING) |
| GET | `/challenges/:id` | Details, hints, attachments, first blood |
| POST | `/challenges/:id/submit` | Submit a flag |
| POST | `/challenges/:id/hints/:hintId/unlock` | Reveal a hint |
| GET | `/challenges/:id/attachments/:attachmentId` | Download an attachment |

### Admin

| Method | Path | |
|---|---|---|
| GET | `/admin/dashboard` | Counters and recent submissions |
| GET / POST | `/admin/challenges` | List / create |
| PUT / DELETE | `/admin/challenges/:id` | Edit (incl. enable/disable) / delete |
| POST | `/admin/challenges/:id/attachments` | Upload files (multipart field `files`) |
| DELETE | `/admin/attachments/:id` | Delete a file |
| GET | `/admin/users` | Paginated, searchable user list |
| PUT | `/admin/users/:id` | `{ disabled }` or `{ resetPassword: true }` |
| GET | `/admin/users/:id/submissions` | A user's submissions |
| GET / PUT | `/admin/event` | Read / update name and schedule |
| POST | `/admin/event/state` | `{ action: "start" \| "pause" \| "end" \| "reset" }` |
| POST | `/admin/announcements` | Publish |
| DELETE | `/admin/announcements/:id` | Delete |

No endpoint ever returns a flag, a flag hash, or a password hash.

---

## 13. Project structure

```
king-of-pirates/
├── frontend/
│   ├── public/brand/          organizer-supplied emblem / ship images
│   ├── src/
│   │   ├── components/        UI kit, scenery art, challenge sheet, route guards
│   │   ├── pages/             landing, login, register, dashboard, challenges,
│   │   │   └── admin/         scoreboard, rules, profile, error pages, admin panel
│   │   ├── layouts/           app shell (header, nav, footer), admin layout
│   │   ├── hooks/             data fetching, server-synced countdown
│   │   ├── services/          API client, types
│   │   ├── context/           auth, live updates (SSE), toasts
│   │   └── utils/             formatting
│   ├── nginx.conf             container nginx: static files + /api proxy
│   ├── Dockerfile
│   └── vite.config.ts
├── backend/
│   ├── src/
│   │   ├── controllers/       request handlers
│   │   ├── routes/            route tables
│   │   ├── middleware/        auth, CSRF, rate limits, error handling
│   │   ├── services/          flags, scoring, event state, SSE hub, seed, uploads
│   │   ├── utils/             validation schemas, flag hashing, errors
│   │   ├── app.ts             Express app
│   │   └── server.ts          entry point
│   ├── prisma/
│   │   ├── schema.prisma      database schema
│   │   ├── migrations/        SQL migrations
│   │   └── seed.ts            seed script
│   ├── scripts/               demo launcher, load test
│   ├── tests/                 124 tests
│   └── Dockerfile
├── uploads/                   challenge attachments (git-ignored)
├── docs/SECURITY.md
├── docker-compose.yml
├── .env.example
├── README.md
└── package.json               npm workspaces
```

**Database models:** `User`, `Category`, `Challenge`, `Hint`, `HintUnlock`, `Attachment`,
`Submission`, `Solve`, `FirstBlood`, `ScoreEvent`, `Announcement`, `Achievement`,
`UserAchievement`, `Event`.

---

## 14. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `[fatal] JWT_SECRET must be set…` | Production needs a real secret of ≥ 32 characters in `.env`. |
| `[fatal] DEMO_MODE must never be enabled…` | Remove `DEMO_MODE=true` — it is not allowed with `NODE_ENV=production`. |
| No admin account / cannot log in as admin | `ADMIN_PASSWORD` is empty or `CHANGE_ME`. Set it, then re-run the seed (`npx prisma db seed`) or restart the backend container. |
| Logging in works but every action fails with 403 `CSRF_ORIGIN` | `FRONTEND_URL` does not match the address in the browser. Set it to the exact public origin. |
| Logged out immediately after logging in (production) | `COOKIE_SECURE=true` but the site is served over plain HTTP. Enable HTTPS, or set it to `false` on a LAN. |
| Leaderboard does not update live behind nginx | The proxy is buffering the event stream. Use the `/api/stream` block from section 10.6. |
| Everyone is rate-limited at once | The backend sees all requests as one IP. Set `TRUST_PROXY_HOPS` to the number of proxies in front of it. |
| The Vite dev site loads but `/api` calls hang | The backend is not on port 5000. Set `VITE_API_PROXY` in `.env`. |
| Login shows *"Can't reach the game server"* / the API prints `Cannot connect to PostgreSQL` | `npm run dev` needs a running PostgreSQL. Start it with `docker compose up -d postgres`, or use `npm run demo`, which needs no database server. |
| `npm run demo` exits with `[fatal] Aborted()` | The embedded demo database is damaged or sits in a synced folder (OneDrive, Dropbox). Delete the `demo-db` folder printed at start-up, or point `DEMO_DATABASE_URL` at a local, non-synced directory. |

---

☠ **BLACK BASTA CTF** — Set sail. Hack responsibly. Claim the treasure.

© 2026 Black Basta
