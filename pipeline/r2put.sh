#!/usr/bin/env bash
# Uploads a file to the Spots bucket in R2, trying three times: once, New York's 172 MB store failed at the end of its
# multipart upload ("InvalidPart … One or more of the specified parts could not be found") after a 22-minute build,
# where every other state's went through. Run with R2, BUCKET and the AWS variables set:
#   ./r2put.sh data/WA.sqlite.gz stores/WA.sqlite.gz
set -u
for try in 1 2 3; do
  aws s3 cp --only-show-errors --endpoint-url "$R2" "$1" "s3://$BUCKET/$2" && exit 0
  echo "Upload of $1 failed ($try of 3)"; sleep $((try * 15))
done
exit 1
