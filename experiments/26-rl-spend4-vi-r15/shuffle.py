"""Shuffle test of experiment 26: the policy's actions permuted at random across its entries (same states, about
the same action shares, no link between state and action). Writes policy-shuffled<seed>.tsv next to this file.
Then, from engine/:
  ./target/release/rl-value eval --actions spend4 --policy ../experiments/26-rl-spend4-vi-r15/policy-shuffled1.tsv \
    --n 2000 --seed-start 700000000 --out ../experiments/26-rl-spend4-vi-r15/val-shuffled1.json
"""
import os
import random

here = os.path.dirname(os.path.abspath(__file__))
lines = open(os.path.join(here, "policy-m200.tsv")).read().splitlines()
header, cols, rows = lines[0], lines[1], [r.split("\t") for r in lines[2:]]
ia = cols.split("\t").index("action")
for seed in (1, 2):
    acts = [r[ia] for r in rows]
    random.Random(seed).shuffle(acts)
    with open(os.path.join(here, f"policy-shuffled{seed}.tsv"), "w") as f:
        f.write(header + "\n" + cols + "\n")
        for r, a in zip(rows, acts):
            f.write("\t".join(r[:ia] + [a] + r[ia + 1:]) + "\n")
