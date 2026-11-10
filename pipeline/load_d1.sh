#!/usr/bin/env bash
# Loads the SQL files the Spots workflows leave in R2 (d1/<ST>.<suffix>) into D1, one state at a time: D1 serves no
# queries while it imports a file (the app's sign-in included), and two imports at once can trip over each other.
# Each file replaces its state's rows, so loading one again is safe; it's removed from R2 once loaded, so a state whose
# build failed keeps the rows it had. Run from app/, with R2, BUCKET and the AWS and Cloudflare variables set:
#   ../pipeline/load_d1.sh sql.gz WA OR          (spots data)
#   ../pipeline/load_d1.sh guides.sql.gz WA      (guides)
set -uo pipefail
suffix=$1; shift
tmp=${RUNNER_TEMP:-/tmp}
failed=""
for ST in "$@"; do
  key="d1/$ST.$suffix"
  if ! aws s3 cp --endpoint-url "$R2" "s3://$BUCKET/$key" "$tmp/$ST.sql.gz" > /dev/null 2>&1; then
    echo "$ST: nothing new to load"; continue
  fi
  gunzip -f "$tmp/$ST.sql.gz"
  ok=""
  # Once, wrangler lost track of an import it had run ("Not currently importing anything"); the same file loaded fine
  # on the next run.
  for try in 1 2 3; do
    if npx wrangler d1 execute waythread --remote --file "$tmp/$ST.sql" > "$tmp/$ST.log" 2>&1; then
      ok=1; break
    fi
    tail -5 "$tmp/$ST.log"; echo "$ST: load $try failed; trying again in 30 s"; sleep 30
  done
  if [ -n "$ok" ]; then
    line="$ST: $(grep -o 'Executed.*' "$tmp/$ST.log" | head -1)"
    echo "$line"; [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "- $line" >> "$GITHUB_STEP_SUMMARY"
    aws s3 rm --endpoint-url "$R2" "s3://$BUCKET/$key" > /dev/null
  else
    failed="$failed $ST"
  fi
  rm -f "$tmp/$ST.sql"
done
if [ -n "$failed" ]; then echo "Not loaded:$failed (run the workflow again for them)"; exit 1; fi
