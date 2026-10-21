#!/usr/bin/env bash
# Puts a Kitchen Table release on the VPS and restarts it, keeping the last
# three so going back is quick. Run as root (deploy.ps1 does this):
#
#   bash install-release.sh kitchen-table-v0.2.0.tar.gz
#
# To go back: ln -sfn /opt/kitchen-table/releases/<older> /opt/kitchen-table/current
# and systemctl restart kitchen-table.
set -euo pipefail

TARBALL=${1:?Usage: install-release.sh <kitchen-table-*.tar.gz>}
ROOT=/opt/kitchen-table
name=$(basename "$TARBALL" .tar.gz)-$(date +%Y%m%d-%H%M%S)

mkdir -p "$ROOT/releases/$name"
tar -xzf "$TARBALL" -C "$ROOT/releases/$name"
ln -sfn "$ROOT/releases/$name" "$ROOT/current.new"
mv -T "$ROOT/current.new" "$ROOT/current"
systemctl restart kitchen-table

printf 'Starting'
for _ in $(seq 1 60); do
  if status=$(curl -fsS http://127.0.0.1:4000/api/setup 2>/dev/null); then
    printf ' running %s\n' "$name"
    break
  fi
  printf '.'
  sleep 1
done
if [ -z "${status:-}" ]; then
  printf ' it did not start. The log:\n'
  journalctl -u kitchen-table -n 40 --no-pager
  exit 1
fi

if [ -f /var/lib/kitchen-table/setup_code ]; then
  printf 'Waiting to be set up. The setup code is: %s\n' "$(cat /var/lib/kitchen-table/setup_code)"
fi

ls -1dt "$ROOT"/releases/*/ | tail -n +4 | xargs -r rm -rf
