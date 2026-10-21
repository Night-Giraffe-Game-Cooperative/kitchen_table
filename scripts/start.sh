#!/usr/bin/env bash
# Starts Kitchen Table on a Mac or Linux computer.
#
# Builds the web app, sets up the server the first time, then runs it on
# http://localhost:4000, and on https://<this computer's address>:4443 for the
# tablets and phones on the home Wi-Fi (the camera needs a secure address).
# Stop it with Ctrl+C.
#
#   scripts/start.sh
#
# Needs Erlang/OTP 26 or newer, Elixir 1.17 or newer and Node 20 or newer.

set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
port="${PORT:-4000}"

for tool in erl mix node npm; do
  if ! command -v "$tool" >/dev/null; then
    echo "Can't find '$tool'. Install Erlang and Elixir (https://elixir-lang.org/install.html) and Node (https://nodejs.org)." >&2
    exit 1
  fi
done

cd "$root/web"
[ -d node_modules ] || { echo "== Installing the web app's packages"; npm ci; }
echo "== Building the web app"
npm run build

cd "$root/server"
[ -d deps ] || { echo "== Fetching the server's packages"; mix deps.get; }
echo "== Getting the database ready"
mix do ecto.create --quiet + ecto.migrate --quiet

echo
echo "Kitchen Table is starting. Open http://localhost:$port on this computer."
https="${HTTPS_PORT:-4443}"
for ip in $( (hostname -I 2>/dev/null || ipconfig getifaddr en0 2>/dev/null || true) ); do
  case "$ip" in
    *:*|127.*) ;;
    *) if [ "$https" = off ]; then echo "On a tablet or phone on the same Wi-Fi: http://$ip:$port"
       else echo "On a tablet or phone on the same Wi-Fi: https://$ip:$https"; fi ;;
  esac
done
if [ "$https" != off ]; then
  echo "Tablets and phones need the https address for the camera in video calls. The first time, the"
  echo "browser warns that the connection is not private: choose Advanced, then Continue. It's your own computer."
fi
echo

exec mix phx.server
