/**
 * Game records: everything needed to rebuild the exact state sequence of a game.
 *
 * A record stores the creation options (incl. seed and clans), every action in
 * order with the player who took it, the full state at the start of every
 * player-turn, and the result. Because the engine is deterministic,
 * replayStates(record) returns the full state after every single action.
 */
import { applyAction } from "../engine/actions";
import { createGame, scoreOf } from "../engine/state";
import type { Action, GameMode, GameState } from "../engine/types";
import type { MapType } from "../engine/mapgen";

export type Seat =
  | { kind: "human"; profileId: string; name: string }
  | { kind: "model"; modelId: string };

export type GameOptions = {
  mapSize: number;
  players: number;
  mode: GameMode;
  seed: number;
  mapType?: MapType;
  /** the clans that were dealt (for reading); replay re-deals them from the seed */
  clans: string[];
  /** only set when the game was created with an explicit clan list */
  explicitClans?: string[];
};

export type GameRecord = {
  version: 1;
  id: string;
  startedAt: string;
  endedAt: string | null;
  /** "play" = at least one human seat, "arena" = models only */
  source: "play" | "arena";
  options: GameOptions;
  seats: Seat[];
  /** every action in order; p = the player who took it */
  steps: { p: number; a: Action }[];
  /** full state at the start of every player-turn (turn, current) */
  turnStates: GameState[];
  result: { over: boolean; winner: number | null; turns: number; scores: number[]; alive: boolean[] } | null;
};

export function seatKey(seat: Seat): string {
  return seat.kind === "human" ? `human:${seat.profileId}` : `model:${seat.modelId}`;
}

export function newRecordId(startedAt: Date, seed: number): string {
  const t = startedAt.toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
  return `${t}-${(seed >>> 0).toString(36)}`;
}

/** start a record for a freshly created game */
export function startRecord(s: GameState, seats: Seat[], source: GameRecord["source"], mapType?: MapType): GameRecord {
  const now = new Date();
  return {
    version: 1,
    id: newRecordId(now, s.seed),
    startedAt: now.toISOString(),
    endedAt: null,
    source,
    options: {
      mapSize: s.mapSize,
      players: s.players.length,
      mode: s.mode,
      seed: s.seed,
      mapType,
      clans: s.players.map((p) => p.clan),
    },
    seats,
    steps: [],
    turnStates: [s],
    result: null,
  };
}

/** append one applied action; snapshots the state whenever a new player-turn begins */
export function recordStep(rec: GameRecord, before: GameState, a: Action, after: GameState): void {
  rec.steps.push({ p: before.current, a });
  if (after.current !== before.current || after.turn !== before.turn) rec.turnStates.push(after);
}

export function finishRecord(rec: GameRecord, s: GameState): GameRecord {
  rec.endedAt = new Date().toISOString();
  rec.result = {
    over: s.over,
    winner: s.winner,
    turns: s.turn,
    scores: s.players.map((p) => scoreOf(s, p.id)),
    alive: s.players.map((p) => p.alive),
  };
  return rec;
}

/** rebuild the initial state of a record */
export function initialState(rec: GameRecord): GameState {
  const o = rec.options;
  return createGame({
    mapSize: o.mapSize,
    players: o.players,
    mode: o.mode,
    seed: o.seed,
    mapType: o.mapType,
    clans: o.explicitClans as never,
    humans: rec.seats.flatMap((s, i) => (s.kind === "human" ? [i] : [])),
  });
}

/** the full state sequence: element 0 is the start, element k is the state after step k */
export function replayStates(rec: GameRecord): GameState[] {
  let s = initialState(rec);
  const out = [s];
  for (const { a } of rec.steps) {
    s = applyAction(s, a);
    out.push(s);
  }
  return out;
}
