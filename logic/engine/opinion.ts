/**
 * What bots think of you (rules doc, Diplomacy > What bots think of you).
 * A bot rates another tribe horrible, poor, indifferent, decent or great from
 * the factors in the doc's table; each factor that holds counts +1 or -1. The
 * doc gives no weights or thresholds, so these are engine choices
 * (docs/RULES_PARITY.md). A bot accepts and sends peace offers only at great.
 */
import { atPeace, atWar, brokeTreatyWith, lastAttackTurn } from "./diplomacy";
import { around, idx } from "./grid";
import { canSee, territoryOwner } from "./movement";
import { difficultyOf, scoreOf } from "./state";
import type { GameState } from "./types";

export type OpinionLevel = "horrible" | "poor" | "indifferent" | "decent" | "great";

export type OpinionFactor =
  | "wise"
  | "charming"
  | "peaceful"
  | "diplomatic"
  | "powerful"
  | "brave"
  | "violent"
  | "threatening"
  | "weak"
  | "annoying"
  | "foolish"
  | "intrusive"
  | "dominating";

export const POSITIVE_FACTORS: OpinionFactor[] = ["wise", "charming", "peaceful", "diplomatic", "powerful", "brave"];

/** turns without an attack on the bot after which it counts you Peaceful (attacks within them: Violent) */
export const PEACEFUL_TURNS = 3;

/** chance a bot finds a tribe Charming, by difficulty (more often on easy bots) */
const CHARMING_CHANCE = { easy: 0.5, normal: 0.3, hard: 0.15, crazy: 0.05 } as const;

/** deterministic per game, bot and tribe, so the opinion doesn't flicker */
function charmRoll(s: GameState, bot: number, other: number): number {
  let h = (s.seed ^ Math.imul(bot + 1, 0x9e3779b1) ^ Math.imul(other + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

const unitsOf = (s: GameState, p: number) => s.units.filter((u) => u.owner === p);

export function opinionFactors(s: GameState, bot: number, other: number): OpinionFactor[] {
  const out: OpinionFactor[] = [];
  const n = s.mapSize;
  const rivals = s.players.filter((x) => x.alive && x.id !== bot && x.id !== other).map((x) => x.id);
  // Wise: shares a friend or an enemy with the bot
  if (rivals.some((x) => (atPeace(s, bot, x) && atPeace(s, other, x)) || (atWar(s, bot, x) && atWar(s, other, x))))
    out.push("wise");
  if (charmRoll(s, bot, other) < CHARMING_CHANCE[difficultyOf(s)]) out.push("charming");
  const last = lastAttackTurn(s, other, bot);
  if (last === null || s.turn - last >= PEACEFUL_TURNS) out.push("peaceful");
  else out.push("violent");
  if (s.players[bot].embassies.includes(other) || s.players[other].embassies.includes(bot)) out.push("diplomatic");
  const mine = unitsOf(s, bot).length;
  const theirs = unitsOf(s, other);
  if (theirs.length > mine) out.push("powerful");
  // Brave: at war with the strongest tribe (other than the two)
  let strongest: number | null = null;
  let best = -Infinity;
  for (const x of rivals) {
    const sc = scoreOf(s, x);
    if (sc > best) {
      best = sc;
      strongest = x;
    }
  }
  if (strongest !== null && atWar(s, other, strongest)) out.push("brave");
  // Threatening: their units inside or next to the bot's land
  const botLand = (x: number, y: number) => territoryOwner(s, s.tiles[idx(n, x, y)]) === bot;
  if (theirs.some((u) => botLand(u.x, u.y) || around(n, u, 1).some((q) => botLand(q.x, q.y)))) out.push("threatening");
  // Weak: the bot sees fewer of their units than it has
  if (theirs.filter((u) => canSee(s, bot, u)).length < mine) out.push("weak");
  const d = difficultyOf(s);
  if (d === "hard" || d === "crazy") out.push("annoying");
  // Foolish: at war with the bot's friends or at peace with its enemies; forever after a broken treaty
  if (
    brokeTreatyWith(s, other, bot) ||
    rivals.some((x) => (atPeace(s, bot, x) && atWar(s, other, x)) || (atWar(s, bot, x) && atPeace(s, other, x)))
  )
    out.push("foolish");
  // Intrusive: their borders touch the bot's
  const touches = s.tiles.some((t, i) => {
    if (territoryOwner(s, t) !== other) return false;
    return around(n, { x: i % n, y: Math.floor(i / n) }, 1).some((q) => botLand(q.x, q.y));
  });
  if (touches) out.push("intrusive");
  // Dominating: close to winning Domination (half of all cities or more)
  const cities = s.cities.length;
  const held = s.cities.filter((c) => c.owner === other).length;
  if (cities >= 4 && held * 2 >= cities) out.push("dominating");
  return out;
}

export function opinionScore(s: GameState, bot: number, other: number): number {
  return opinionFactors(s, bot, other).reduce((sum, f) => sum + (POSITIVE_FACTORS.includes(f) ? 1 : -1), 0);
}

export function opinionLevel(score: number): OpinionLevel {
  if (score <= -3) return "horrible";
  if (score < 0) return "poor";
  if (score === 0) return "indifferent";
  if (score < 3) return "decent";
  return "great";
}

export function opinionOf(s: GameState, bot: number, other: number): OpinionLevel {
  return opinionLevel(opinionScore(s, bot, other));
}
