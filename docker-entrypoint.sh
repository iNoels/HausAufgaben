#!/bin/sh
set -eu

UID="${UID:-1000}"
GID="${GID:-1000}"
TZ="${TZ:-Europe/Berlin}"

if [ -f "/usr/share/zoneinfo/${TZ}" ]; then
  ln -snf "/usr/share/zoneinfo/${TZ}" /etc/localtime
  echo "${TZ}" > /etc/timezone
else
  echo "Warning: TZ '${TZ}' not found, using default timezone data."
fi

chown -R "${UID}:${GID}" /app

exec su-exec "${UID}:${GID}" "$@"
