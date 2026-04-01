#!/usr/bin/env bash
# Safety net: kills bun processes using more than 2GB RSS.
# Intended to run as a cron job every 5 minutes.
# Only targets bun processes matching known test/bridge patterns.

THRESHOLD_KB=$((2 * 1024 * 1024))  # 2GB in KB

ps -eo pid,rss,args --no-headers | while read -r pid rss args; do
  [[ "$args" != *bun* ]] && continue
  [[ "$args" != *src/index.ts* && "$args" != *server.ts* && "$args" != *asterisk-bridge* ]] && continue

  if (( rss > THRESHOLD_KB )); then
    echo "$(date -Iseconds) Killing runaway bun process $pid (${rss}KB): ${args:0:120}" >> /tmp/kill-runaway-bun.log
    kill -9 "$pid" 2>/dev/null
  fi
done
