// Notable events of a replayed game, for the watch view's event feed. Derived by comparing
// consecutive states, so they describe what actually happened (a capture, a kill), not just
// which action was chosen. Minor actions (moves, harvests, ordinary builds) are left out.
import type { GameRecord } from "@/logic/arena/record";
import { scoreOf } from "@/logic/engine";
import type { GameState } from "@/logic/engine/types";
import { actionLabel, name } from "@/logic/engine/names";

export type EventKind = "city" | "combat" | "tech" | "wonder" | "diplomacy" | "lead" | "elimination";
export type GameEvent = {
  /** the state index after which it happened (states[step]) */
  step: number;
  turn: number;
  kind: EventKind;
  /** the player it is about (its colour marks the row) */
  player: number;
  text: string;
};

export const EVENT_KINDS: { kind: EventKind; label: string }[] = [
  { kind: "city", label: "Cities" },
  { kind: "combat", label: "Combat" },
  { kind: "tech", label: "Tech" },
  { kind: "wonder", label: "Monuments" },
  { kind: "diplomacy", label: "Diplomacy" },
  { kind: "lead", label: "Lead" },
  { kind: "elimination", label: "Eliminations" },
];

const leaderOf = (s: GameState) => {
  let best = -1;
  let bestScore = -Infinity;
  for (const p of s.players) {
    if (!p.alive) continue;
    const sc = scoreOf(s, p.id);
    if (sc > bestScore) {
      bestScore = sc;
      best = p.id;
    }
  }
  return { id: best, score: bestScore };
};

/** the events of step `i` (from states[i-1] to states[i]); `who` names a seat */
function eventsOfStep(rec: GameRecord, states: GameState[], i: number, who: (p: number) => string): GameEvent[] {
  const a = states[i - 1];
  const b = states[i];
  const step = rec.steps[i - 1];
  const actor = step.p;
  const out: GameEvent[] = [];
  const add = (kind: EventKind, player: number, text: string) => out.push({ step: i, turn: b.turn, kind, player, text });

  // cities: captured, founded (a village taken), grown
  const before = new Map(a.cities.map((c) => [c.id, c]));
  for (const c of b.cities) {
    const old = before.get(c.id);
    if (!old) add("city", c.owner, `${who(c.owner)} founded ${c.name}`);
    else if (old.owner !== c.owner) add("city", c.owner, `${who(c.owner)} captured ${c.name} from ${who(old.owner)}${old.capital ? " (a capital!)" : ""}`);
    else if (c.level > old.level) add("city", c.owner, `${who(c.owner)}'s ${c.name} grew to level ${c.level}`);
  }
  // units killed (gone after someone else's action; a disband or an upgrade is the owner's own)
  const alive = new Set(b.units.map((u) => u.id));
  for (const u of a.units) {
    if (!alive.has(u.id) && u.owner !== actor) add("combat", actor, `${who(actor)} killed ${who(u.owner)}'s ${name("unit", u.type)}`);
  }
  // players: eliminated, new monuments
  for (const p of b.players) {
    const old = a.players[p.id];
    if (old.alive && !p.alive) add("elimination", actor, `${who(p.id)} was eliminated by ${who(actor)}`);
    for (const m of p.monuments) if (!old.monuments.includes(m)) add("wonder", p.id, `${who(p.id)} built ${name("building", m)}`);
  }
  // chosen actions worth a line
  const t = step.a.type;
  if (t === "research") add("tech", actor, `${who(actor)} researched ${actionLabel(a, step.a).replace(/^Research /, "")}`);
  if (t === "offerPeace" || t === "acceptPeace" || t === "declinePeace" || t === "breakPeace") add("diplomacy", actor, `${who(actor)}: ${actionLabel(a, step.a)}`);
  return out;
}

/**
 * Events for states[1..]; extends `prev` (events of an earlier, shorter replay of the same game)
 * instead of recomputing from the start.
 */
export type EventLog = { upTo: number; events: GameEvent[]; leader: number };
export function extendEvents(prev: EventLog | null, rec: GameRecord, states: GameState[], who: (p: number) => string): EventLog {
  const fresh = !prev || prev.upTo > states.length - 1;
  const from = fresh ? 1 : prev.upTo + 1;
  const events = fresh ? [] : prev.events.slice();
  let leader = fresh ? -1 : prev.leader;
  for (let i = from; i < states.length; i++) {
    events.push(...eventsOfStep(rec, states, i, who));
    // lead changes: scoring goes through the engine, so check only when a player's turn ends
    const b = states[i];
    if (b.current !== states[i - 1].current || b.over) {
      const l = leaderOf(b);
      if (b.turn >= 2 && l.id >= 0 && l.id !== leader && leader >= 0) {
        events.push({ step: i, turn: b.turn, kind: "lead", player: l.id, text: `${who(l.id)} takes the lead with ${l.score.toLocaleString("en")} points` });
      }
      leader = l.id;
    }
  }
  return { upTo: states.length - 1, events, leader };
}

export type Standing = {
  id: number;
  alive: boolean;
  score: number;
  cities: number;
  units: number;
  techs: number;
  stars: number;
  territory: number;
  kills: number;
};

export const STANDING_COLUMNS: { key: Exclude<keyof Standing, "id" | "alive">; label: string; title: string }[] = [
  { key: "score", label: "Score", title: "score" },
  { key: "cities", label: "Cities", title: "cities" },
  { key: "units", label: "Units", title: "units" },
  { key: "territory", label: "Land", title: "tiles of territory" },
  { key: "techs", label: "Tech", title: "techs researched" },
  { key: "stars", label: "★", title: "stars in the bank" },
  { key: "kills", label: "Kills", title: "units killed" },
];

export function standings(s: GameState): Standing[] {
  const cityOwner = new Map(s.cities.map((c) => [c.id, c.owner]));
  return s.players.map((p) => ({
    id: p.id,
    alive: p.alive,
    score: scoreOf(s, p.id),
    cities: s.cities.filter((c) => c.owner === p.id).length,
    units: s.units.filter((u) => u.owner === p.id).length,
    techs: p.techs.length,
    stars: p.stars,
    territory: s.tiles.filter((t) => t.territory !== null && cityOwner.get(t.territory) === p.id).length,
    kills: p.kills,
  }));
}
