#!/bin/sh
# Starts the app inside a GitHub Codespace.
#  - Only for you:        no secrets set  -> normal local mode (private port, you sign in to Amelia on the page).
#  - One link for others:  ACCESS_CODE and ALLOWED_AMELIA_HOSTS secrets set -> hosted mode (access code, private workspace per person)
#                          and the port is made Public so people without a GitHub account can open the link.
cd "$(dirname "$0")/.." || exit 1
if [ -n "$ACCESS_CODE" ]; then
  if [ -z "$ALLOWED_AMELIA_HOSTS" ]; then echo "Add the Codespaces secret ALLOWED_AMELIA_HOSTS (your Amelia host name), then rebuild the codespace."; exit 1; fi
  export HOSTED=1
  ( sleep 8; gh codespace ports visibility 8740:public -c "$CODESPACE_NAME" >/dev/null 2>&1 \
      && echo "Port 8740 is now Public. Share the link: https://${CODESPACE_NAME}-8740.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}" \
      || echo "Make the port Public by hand: Ports tab -> right-click 8740 -> Port Visibility -> Public." ) &
  echo "Hosted mode: access code required."
fi
exec node server.js
