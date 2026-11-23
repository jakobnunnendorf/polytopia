#!/bin/zsh
# Restart the live web preview on port 8090 with a cleared bundler cache,
# so it serves exactly the current code. Run from the repo root.
# Phone: http://<mac LAN ip>:8090   Mac: http://localhost:8090
PORT=${PORT:-8090}
for pid in $(lsof -ti tcp:$PORT); do kill $pid 2>/dev/null; done
/bin/sleep 1
exec env CI=1 npx expo start --web --port $PORT --clear
