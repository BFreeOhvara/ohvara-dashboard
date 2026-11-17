#!/bin/bash
# P1028: commits rec/ back to this throwaway branch (the iOS and Android jobs race, so retry on a rebase).
set -u
git config user.name "p1028-recorder"; git config user.email "p1028-recorder@users.noreply.github.com"
git add -f rec/ && git commit -q -m "rec: $1" || exit 0
for i in 1 2 3 4 5; do
  git pull -q --rebase origin "$GITHUB_REF_NAME" && git push -q origin "HEAD:$GITHUB_REF_NAME" && exit 0
  sleep $((i * 5))
done
exit 1
