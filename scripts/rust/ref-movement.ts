/**
 * Reference values for the Rust port of diplomacy.ts, combat.ts and movement.ts
 * (opinions follow the game's decompiled model since and are tested in opinion.rs): plays corpus games (trace-gen specFor) with the TypeScript
 * engine and records, at sampled states, what those modules return. The Rust
 * tests (engine/core/src/movement.rs) load the file and compare.
 *
 *   node -r sucrase/register scripts/rust/ref-movement.ts --games 30 --every 97 --out engine/core/testdata/ref-movement.json
 */
import fs from "node:fs";
import path from "node:path";
import { applyAction, legalActions } from "../../logic/engine/actions";
import { botStep } from "../../logic/engine/bot";
import { computeDamageRounded, defenceBonus } from "../../logic/engine/combat";
import { atPeace, atWar, canHarm, hasOffer, relation } from "../../logic/engine/diplomacy";
import { around, tileAt } from "../../logic/engine/grid";
import { canSee, enterKind, followerOf, leaderOf, movementRange, pathTo, reachable, sightRadius } from "../../logic/engine/movement";
import { createGame } from "../../logic/engine/state";
import type { GameState } from "../../logic/engine/types";
import { WEIGHT_SETS, policyRng, specFor } from "./trace-gen";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const games = Number(arg("games", "30"));
const first = Number(arg("first", "0"));
const every = Number(arg("every", "97"));
const out = path.resolve(arg("out", "engine/core/testdata/ref-movement.json"));

function record(s: GameState) {
  const n = s.mapSize;
  const units = s.units.map((u) => {
    const r = reachable(s, u);
    const targets = r.slice(0, 3).map((t) => ({ x: t.x, y: t.y }));
    // also a tile it cannot reach, and its own tile
    targets.push({ x: (u.x + 3) % n, y: (u.y + 2) % n }, { x: u.x, y: u.y });
    const leader = leaderOf(s, u);
    const follower = followerOf(s, u);
    return {
      id: u.id,
      reach: r.map((t) => [t.x, t.y, t.kind]),
      paths: targets.map((t) => ({ to: t, path: pathTo(s, u, t).map((c) => [c.x, c.y]) })),
      see: s.players.map((p) => canSee(s, p.id, u)),
      range: movementRange(s, u),
      sight: sightRadius(s, u),
      enter: around(n, u, 2, true).map((c) => [c.x, c.y, enterKind(s, u, tileAt(s, c.x, c.y))]),
      leader: leader ? leader.id : null,
      follower: follower ? follower.id : null,
      bonus: defenceBonus(s, u),
    };
  });
  const combat: [number, number, number, number][] = [];
  for (const a of s.units)
    for (const d of s.units) {
      if (a.owner === d.owner || Math.max(Math.abs(a.x - d.x), Math.abs(a.y - d.y)) > 4) continue;
      const r = computeDamageRounded(s, a, d);
      combat.push([a.id, d.id, r.damage, r.retaliation]);
    }
  const pairs: unknown[] = [];
  for (const a of s.players)
    for (const b of s.players) {
      pairs.push({
        a: a.id,
        b: b.id,
        rel: relation(s, a.id, b.id),
        peace: atPeace(s, a.id, b.id),
        war: atWar(s, a.id, b.id),
        harm: canHarm(s, a.id, b.id),
        offer: hasOffer(s, a.id, b.id),
      });
    }
  return { state: s, units, combat, pairs };
}

const cases: unknown[] = [];
for (let id = first; id < first + games; id++) {
  const spec = specFor(id);
  let s: GameState;
  try {
    s = createGame(spec.opts);
  } catch {
    continue;
  }
  const rand = policyRng(spec.policySeed);
  const w = WEIGHT_SETS[spec.weights];
  let step = 0;
  cases.push(record(s));
  while (!s.over && step < spec.maxSteps) {
    const legal = legalActions(s);
    if (!legal.length) break;
    const a = rand() < Math.max(spec.pRandom, 0.1) ? legal[Math.floor(rand() * legal.length)] : botStep(s, w);
    s = applyAction(s, a);
    step++;
    if (step % every === 0) cases.push(record(s));
  }
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(cases));
console.log(`${cases.length} states -> ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
