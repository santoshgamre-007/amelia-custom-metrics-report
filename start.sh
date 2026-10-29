#!/bin/sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then echo "Node.js is not installed. Install the LTS version from https://nodejs.org and run this again."; exit 1; fi
[ -d node_modules ] || { echo "First start: installing (about a minute, needs internet)..."; npm install --no-audit --no-fund || exit 1; }
( sleep 3; (open http://127.0.0.1:8740 || xdg-open http://127.0.0.1:8740) >/dev/null 2>&1 ) &
echo "Starting. Press Ctrl+C to stop."
node server.js
