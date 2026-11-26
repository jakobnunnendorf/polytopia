#!/bin/zsh
# Restart the live web preview on port 8090 with a cleared bundler cache,
# so it serves exactly the current code, plus the arena server on port 8091
# (records games into data/, keeps profiles and Elo).
# Run from the repo root.
# Phone: http://<mac LAN ip>:8090   Mac: http://localhost:8090
PORT=${PORT:-8090}
ARENA_PORT=${ARENA_PORT:-8091}
for pid in $(lsof -ti tcp:$PORT) $(lsof -ti tcp:$ARENA_PORT); do kill $pid 2>/dev/null; done
/bin/sleep 1
ARENA_PORT=$ARENA_PORT node -r sucrase/register scripts/arena-server.ts > /tmp/shardlands-arena.log 2>&1 &
exec env CI=1 npx expo start --web --port $PORT --clear
