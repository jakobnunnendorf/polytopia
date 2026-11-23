#!/bin/zsh
# Fill the rating filters with data: every bot pairing in several formats, plus free-for-alls.
# Runs one game at a time (each finished game refits data/ratings.json).
#   zsh scripts/arena-grid.sh            # ~270 games
cd "${0:A:h}/.."
BOTS=(greedy-v1 greedy-hill-v1 greedy-hill-v2 greedy-hill-v3 random-v1)
STRONG=(greedy-v1 greedy-hill-v1 greedy-hill-v2 greedy-hill-v3)
seed=1000000

block() { # label, then arena args
  local label=$1; shift
  local out=$(npm run -s arena -- "$@" --seed $seed 2>&1)
  seed=$((seed + 1000))
  local done=$(print -r -- "$out" | command grep -c "^game ")
  local rated=$(print -r -- "$out" | command grep -c "(won)")
  echo "$(date +%H:%M:%S)  $label: $done games, $rated finished with a winner"
}

pairs() { # mode size games max-turns
  for ((i = 1; i <= ${#BOTS}; i++)); do
    for ((j = i + 1; j <= ${#BOTS}; j++)); do
      block "$1 1v1 ${2}x$2  ${BOTS[i]} vs ${BOTS[j]}" --models ${BOTS[i]},${BOTS[j]} --mode $1 --size $2 --games $3 --max-turns $4
    done
  done
}

pairs domination 11 10 100
pairs perfection 16 6 60
pairs domination 16 6 100
block "perfection 4 players 14x14" --models ${(j:,:)STRONG} --mode perfection --size 14 --games 20 --max-turns 60
block "domination 4 players 14x14" --models ${(j:,:)STRONG} --mode domination --size 14 --games 20 --max-turns 100
block "perfection 3 players 11x11" --models greedy-hill-v2,greedy-hill-v3,greedy-v1 --mode perfection --size 11 --games 12 --max-turns 60
echo "grid done"
