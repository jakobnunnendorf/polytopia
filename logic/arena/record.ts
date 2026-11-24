/**
 * Game records: everything needed to rebuild the exact state sequence of a game.
 *
 * A record stores the creation options (incl. seed and clans), every action in
 * order with the player who took it, the full state at the start of every
 * player-turn, and the result. Because the engine is deterministic,
 * replayStates(record) returns the full state after every single action.
 */
import { applyAction } from "../engine/actions";
import { cloneState } from "../engine/grid";
import { createGame, scoreOf } from "../engine/state";
import type { Action, Difficulty, GameMode, GameState } from "../engine/types";
import type { MapType } from "../engine/mapgen";

export type Seat =
  | { kind: "human"; profileId: string; name: string; clan?: string }
  | { kind: "model"; modelId: string; clan?: string };

export type GameOptions = {
  mapSize: number;
  players: number;
  mode: GameMode;
  /** bot difficulty; records saved before it existed have none and mean "normal" */
  difficulty?: Difficulty;
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
  /** set when a model-only game was stopped before it ended (never resumed, never rated) */
  stoppedAt?: string | null;
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
      difficulty: s.difficulty ?? "normal",
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

/** rebuild the initial state of a record (uses the stored turn-0 snapshot when present so replays stay valid across tribe/mapgen additions) */
export function initialState(rec: GameRecord): GameState {
  if (rec.turnStates && rec.turnStates.length > 0) {
    const s = cloneState(rec.turnStates[0]);
    s.difficulty = s.difficulty ?? rec.options.difficulty ?? "normal";
    return s;
  }
  const o = rec.options;
  return createGame({
    mapSize: o.mapSize,
    players: o.players,
    mode: o.mode,
    difficulty: o.difficulty ?? "normal",
    seed: o.seed,
    mapType: o.mapType,
    clans: (o.explicitClans ?? (o.clans?.length ? o.clans : undefined)) as never,
    humans: rec.seats.flatMap((s, i) => (s.kind === "human" ? [i] : [])),
  });
}

/**
 * Replays a record. A record made by an older engine (other rules) may contain a step the current
 * rules can't apply; the replay stops before it and `divergedAt` gives that step's index.
 */
export function replay(rec: GameRecord): { states: GameState[]; divergedAt: number | null } {
  let s = initialState(rec);
  const states = [s];
  for (let i = 0; i < rec.steps.length; i++) {
    try {
      s = applyAction(s, rec.steps[i].a);
    } catch {
      return { states, divergedAt: i };
    }
    states.push(s);
  }
  return { states, divergedAt: null };
}

/**
 * Replay only the steps added since `prev` (a replay of an earlier, shorter copy of the same
 * record), so a live view does not rebuild the whole game every time a move arrives.
 * Falls back to a full replay when `prev` cannot be extended.
 */
export function extendReplay(prev: { states: GameState[]; divergedAt: number | null } | null, rec: GameRecord): { states: GameState[]; divergedAt: number | null } {
  if (!prev || prev.divergedAt !== null || prev.states.length - 1 > rec.steps.length) return replay(rec);
  const states = prev.states.slice();
  let s = states[states.length - 1];
  for (let i = states.length - 1; i < rec.steps.length; i++) {
    try {
      s = applyAction(s, rec.steps[i].a);
    } catch {
      return { states, divergedAt: i };
    }
    states.push(s);
  }
  return { states, divergedAt: null };
}

/** the full state sequence: element 0 is the start, element k is the state after step k */
export function replayStates(rec: GameRecord): GameState[] {
  return replay(rec).states;
}
