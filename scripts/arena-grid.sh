#!/bin/zsh
# Fill the rating filters with data: bot pairings in several formats, plus free-for-alls.
# Runs one game at a time (each finished game refits data/ratings.json).
#   zsh scripts/arena-grid.sh                   # every pairing of the bots below, ~270 games
#   zsh scripts/arena-grid.sh greedy-hill-v4    # rate a new model: only its pairings, plus 40 games
#                                               # against each in 1v1 perfection 11x11, ~360 games
cd "${0:A:h}/.."
NEW=$1
BOTS=(greedy-v1 greedy-hill-v1 greedy-hill-v2 greedy-hill-v3 random-v1)
BOTS=(${BOTS:#$NEW})
if [[ -n $NEW ]]; then
  STRONG=($NEW greedy-hill-v3 greedy-hill-v2 greedy-v1)
  seed=2000000 # other maps than the full grid
else
  STRONG=(greedy-v1 greedy-hill-v1 greedy-hill-v2 greedy-hill-v3)
  seed=1000000
fi

block() { # label, then arena args
  local label=$1; shift
  local out=$(npm run -s arena -- "$@" --seed $seed 2>&1)
  seed=$((seed + 1000))
  local done=$(print -r -- "$out" | command grep -c "^game ")
  local rated=$(print -r -- "$out" | command grep -c "(won)")
  echo "$(date +%H:%M:%S)  $label: $done games, $rated finished with a winner"
}

pairs() { # mode size games max-turns
  local list=($BOTS)
  [[ -n $NEW ]] && list=($NEW $BOTS)
  for ((i = 1; i <= ${#list}; i++)); do
    for ((j = i + 1; j <= ${#list}; j++)); do
      [[ -n $NEW && ${list[i]} != $NEW ]] && continue # a new model: only its own pairings
      block "$1 1v1 ${2}x$2  ${list[i]} vs ${list[j]}" --models ${list[i]},${list[j]} --mode $1 --size $2 --games $3 --max-turns $4
    done
  done
}

[[ -n $NEW ]] && pairs perfection 11 40 60
pairs domination 11 10 100
pairs perfection 16 6 60
pairs domination 16 6 100
block "perfection 4 players 14x14" --models ${(j:,:)STRONG} --mode perfection --size 14 --games 20 --max-turns 60
block "domination 4 players 14x14" --models ${(j:,:)STRONG} --mode domination --size 14 --games 20 --max-turns 100
block "perfection 3 players 11x11" --models ${(j:,:)STRONG[1,3]} --mode perfection --size 11 --games 12 --max-turns 60
echo "grid done"
