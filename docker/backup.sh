#!/bin/sh
# Black Basta automatic backups (runs in the `backup` service of docker-compose.yml).
#
# Every BACKUP_INTERVAL_MINUTES it writes a folder to /backups (BACKUP_DIR on the host):
#   <date_time>/database.dump    full database: restore with pg_restore (see README)
#   <date_time>/*.csv            readable copies (scoreboard, teams, solves, submissions, challenges)
#   uploads/uploads-<date_time>.tar.gz   challenge files, only when they changed
# The newest BACKUP_KEEP folders (and 5 upload archives) are kept; older ones are deleted.
set -eu

INTERVAL_MINUTES="${BACKUP_INTERVAL_MINUTES:-15}"
KEEP="${BACKUP_KEEP:-200}"
ROOT=/backups
BOM="$(printf '\357\273\277')" # so Excel reads names in any language correctly

log() { echo "[backup] $(date '+%Y-%m-%d %H:%M:%S %Z') $*"; }

# One CSV from the SQL query on stdin. Text a spreadsheet would run as a formula
# (=, +, -, @ at the start) is prefixed with ' by the queries below.
csv() {
  query="$(cat)"
  { printf '%s' "$BOM"; psql -X -q -v ON_ERROR_STOP=1 -c "COPY ($query) TO STDOUT WITH CSV HEADER"; } > "$1"
}

backup_once() {
  stamp="$(date '+%Y-%m-%d_%H%M%S')"
  tmp="$ROOT/.partial-$stamp"
  mkdir -p "$tmp" "$ROOT/uploads"

  pg_dump -Fc -f "$tmp/database.dump"

  csv "$tmp/scoreboard.csv" <<'SQL'
SELECT ROW_NUMBER() OVER (ORDER BY u.score DESC, u."scoreReachedAt" ASC NULLS LAST, u.id) AS rank,
       CASE WHEN u.username ~ '^[=+@-]' THEN '''' || u.username ELSE u.username END AS team,
       CASE WHEN array_to_string(u.members, '; ') ~ '^[=+@-]' THEN '''' || array_to_string(u.members, '; ') ELSE array_to_string(u.members, '; ') END AS players,
       u.score, u."solvedCount" AS solved, u."lastSolveAt" AS last_capture
FROM "User" u WHERE u.role = 'participant' AND NOT u.disabled
SQL

  csv "$tmp/teams.csv" <<'SQL'
SELECT u."participantNumber" AS number,
       CASE WHEN u.username ~ '^[=+@-]' THEN '''' || u.username ELSE u.username END AS team,
       CASE WHEN array_to_string(u.members, '; ') ~ '^[=+@-]' THEN '''' || array_to_string(u.members, '; ') ELSE array_to_string(u.members, '; ') END AS players,
       u.email, u.score, u."solvedCount" AS solved, CASE WHEN u.disabled THEN 'Disabled' ELSE 'Active' END AS status,
       u."createdAt" AS created, u."lastActivity" AS last_activity
FROM "User" u WHERE u.role = 'participant' ORDER BY u."participantNumber", u.id
SQL

  csv "$tmp/solves.csv" <<'SQL'
SELECT s."solvedAt" AS solved_at,
       CASE WHEN u.username ~ '^[=+@-]' THEN '''' || u.username ELSE u.username END AS team,
       CASE WHEN s."playerName" ~ '^[=+@-]' THEN '''' || s."playerName" ELSE s."playerName" END AS player,
       c.title AS challenge, cat.name AS category, s.points, s.bonus AS first_blood_bonus, s.points + s.bonus AS total
FROM "Solve" s JOIN "User" u ON u.id = s."userId" JOIN "Challenge" c ON c.id = s."challengeId" JOIN "Category" cat ON cat.id = c."categoryId"
ORDER BY s."solvedAt"
SQL

  csv "$tmp/submissions.csv" <<'SQL'
SELECT sub."submittedAt" AS submitted_at,
       CASE WHEN u.username ~ '^[=+@-]' THEN '''' || u.username ELSE u.username END AS team,
       CASE WHEN sub."playerName" ~ '^[=+@-]' THEN '''' || sub."playerName" ELSE sub."playerName" END AS player,
       c.title AS challenge, CASE WHEN sub.correct THEN 'Correct' ELSE 'Wrong' END AS result,
       CASE WHEN sub."submittedFlag" ~ '^[=+@\t\r-]' THEN '''' || sub."submittedFlag" ELSE sub."submittedFlag" END AS submitted_flag,
       sub.ip
FROM "Submission" sub JOIN "User" u ON u.id = sub."userId" JOIN "Challenge" c ON c.id = sub."challengeId"
ORDER BY sub."submittedAt"
SQL

  csv "$tmp/challenges.csv" <<'SQL'
SELECT c.id, c.title, cat.name AS category, CASE WHEN c.practice THEN 'Practice' ELSE 'Competition' END AS section,
       c.difficulty, c.scoring, c.points, c."minimumPoints" AS minimum_points, c.decay,
       CASE WHEN c.enabled THEN 'Visible' ELSE 'Hidden' END AS status,
       (SELECT count(*) FROM "Solve" s WHERE s."challengeId" = c.id) AS solves,
       (SELECT count(*) FROM "PracticeSolve" p WHERE p."challengeId" = c.id) AS practice_solves
FROM "Challenge" c JOIN "Category" cat ON cat.id = c."categoryId" ORDER BY cat."sortOrder", c.id
SQL

  # Challenge files rarely change: archive them only when the set of files changes.
  fingerprint="$(find /uploads -type f -exec stat -c '%n %s %Y' {} + 2>/dev/null | sort | md5sum | cut -d' ' -f1)"
  if [ "$fingerprint" != "$(cat "$ROOT/uploads/.fingerprint" 2>/dev/null || true)" ]; then
    tar -czf "$ROOT/uploads/.partial.tar.gz" -C /uploads .
    mv "$ROOT/uploads/.partial.tar.gz" "$ROOT/uploads/uploads-$stamp.tar.gz"
    echo "$fingerprint" > "$ROOT/uploads/.fingerprint"
    log "challenge files changed: saved uploads/uploads-$stamp.tar.gz"
    ls -1 "$ROOT/uploads" | grep '^uploads-.*\.tar\.gz$' | sort -r | tail -n +6 | while read -r old; do rm -f "$ROOT/uploads/$old"; done
  fi

  # Only complete backups get a final name.
  mv "$tmp" "$ROOT/$stamp"
  printf '%s\n' "$stamp" > "$ROOT/LATEST.txt"
  log "saved $stamp ($(du -sh "$ROOT/$stamp" | cut -f1))"

  ls -1 "$ROOT" | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}$' | sort -r | tail -n +"$((KEEP + 1))" | while read -r old; do rm -rf "${ROOT:?}/$old"; done
}

# As the container's main process, the shell must handle "stop" itself; the sleep
# runs in the background so a stop interrupts the wait at once.
trap 'log "stopping"; exit 0' TERM INT

log "every $INTERVAL_MINUTES min, keeping the newest $KEEP backups"
while true; do
  rm -rf "$ROOT"/.partial-* 2>/dev/null || true
  # A subshell with -e: any failed step stops this backup (its partial folder is discarded).
  set +e
  ( set -e; backup_once )
  status=$?
  set -e
  [ "$status" -eq 0 ] || log "backup FAILED (exit $status) — will retry at the next interval"
  sleep "$((INTERVAL_MINUTES * 60))" &
  wait $!
done
