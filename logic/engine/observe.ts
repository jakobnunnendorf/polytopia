/**
 * RL observation: what player `p` can know, as numeric planes over the map
 * (channel-major, each plane mapSize×mapSize, row-major) plus scalar features.
 * Unexplored tiles are all-zero except the "explored" plane; hidden enemy
 * units are omitted unless adjacent to one of p's units (canSee).
 */
import { TECHS, UNITS } from "./data";
import { canSee } from "./movement";
import { cityById, income, resourceVisible, scoreOf, techCost } from "./state";
import type { GameState } from "./types";

const TERRAINS = ["field", "forest", "mountain", "water", "ocean"] as const;
const RESOURCES = ["fruit", "crop", "animal", "fish", "metal", "starfish", "aquaCrop", "spores"] as const;
export const UNIT_TYPES = Object.keys(UNITS);

export const CHANNELS = [
  "explored",
  ...TERRAINS.map((t) => `terrain:${t}`),
  ...RESOURCES.map((r) => `resource:${r}`),
  "building",
  "road",
  "village",
  "ruin",
  "flooded",
  "territory:own",
  "territory:enemy",
  "city:own_level",
  "city:enemy_level",
  "unit:own",
  "unit:enemy",
  "unit:hp_frac",
  "unit:can_act",
  ...UNIT_TYPES.map((t) => `unit_type:${t}`),
];

export type Observation = {
  player: number;
  mapSize: number;
  channels: string[];
  /** CHANNELS.length × mapSize × mapSize values */
  planes: number[];
  scalars: {
    turn: number;
    maxTurns: number;
    stars: number;
    income: number;
    score: number;
    cities: number;
    techs: number[];
    techCosts: number[];
    opponentsAlive: number;
  };
};

export function observe(s: GameState, p: number): Observation {
  const n = s.mapSize;
  const N = n * n;
  const C = CHANNELS.length;
  const planes = new Array<number>(C * N).fill(0);
  const ch = (name: string) => CHANNELS.indexOf(name);
  const set = (name: string, i: number, v: number) => {
    planes[ch(name) * N + i] = v;
  };
  const pl = s.players[p];
  for (let i = 0; i < N; i++) {
    if (pl.explored[i] !== 1) continue;
    const t = s.tiles[i];
    set("explored", i, 1);
    set(`terrain:${t.terrain}`, i, 1);
    if (t.resource && resourceVisible(s, p, t.resource)) set(`resource:${t.resource}`, i, 1);
    if (t.building) set("building", i, 1);
    if (t.road) set("road", i, 1);
    if (t.village) set("village", i, 1);
    if (t.ruin) set("ruin", i, 1);
    if (t.flooded) set("flooded", i, 1);
    const owner = cityById(s, t.territory)?.owner;
    if (owner === p) set("territory:own", i, 1);
    else if (owner !== undefined) set("territory:enemy", i, 1);
    if (t.cityId !== null) {
      const c = cityById(s, t.cityId)!;
      set(c.owner === p ? "city:own_level" : "city:enemy_level", i, c.level);
    }
  }
  for (const u of s.units) {
    if (!canSee(s, p, u)) continue;
    const i = u.y * n + u.x;
    set(u.owner === p ? "unit:own" : "unit:enemy", i, 1);
    set("unit:hp_frac", i, u.hp / u.maxHp);
    if (u.owner === p) set("unit:can_act", i, u.canMove || u.canAttack ? 1 : 0);
    set(`unit_type:${u.type}`, i, 1);
  }
  return {
    player: p,
    mapSize: n,
    channels: CHANNELS,
    planes,
    scalars: {
      turn: s.turn,
      maxTurns: s.maxTurns,
      stars: pl.stars,
      income: income(s, p),
      score: scoreOf(s, p),
      cities: s.cities.filter((c) => c.owner === p).length,
      techs: TECHS.map((t) => (pl.techs.includes(t.id) ? 1 : 0)),
      techCosts: TECHS.map((t) => techCost(s, p, t.id)),
      opponentsAlive: s.players.filter((o) => o.alive && o.id !== p).length,
    },
  };
}
