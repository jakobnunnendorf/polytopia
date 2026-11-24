/**
 * Game records: everything needed to rebuild the exact state sequence of a game.
 *
 * A record is like a chess game file: the start position, then every action in
 * order with the player who took it, and the result. Because the engine is
 * deterministic, replayStates(record) returns the full state after every action.
 *
 * It also carries one checkpoint, the position at the start of the newest
 * player-turn (chess: the current position next to the move list). It is derived
 * data, kept so a long game can be continued or watched live without replaying
 * every move. Records used to store such a snapshot for every player-turn, which
 * made a long game 150 MB; slimRecord() turns those into this form.
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
  /** the start position, in element 0. Old records hold one state per player-turn; see slimRecord() */
  turnStates: GameState[];
  /** the state after the first `step` moves, taken at the start of the newest player-turn */
  checkpoint?: { step: number; state: GameState };
  /** only on a liveWindow(): how many earlier moves of the game come before steps[0] */
  base?: number;
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

/** append one applied action; moves the checkpoint whenever a new player-turn begins */
export function recordStep(rec: GameRecord, before: GameState, a: Action, after: GameState): void {
  rec.steps.push({ p: before.current, a });
  if (after.current !== before.current || after.turn !== before.turn) rec.checkpoint = { step: rec.steps.length, state: after };
}

/**
 * The same game without the per-turn snapshots old records carry: only the start position stays.
 * The newest old snapshot becomes the checkpoint when its move number is certain, which it is when
 * every snapshot matches one endTurn (the only action that started a new player-turn).
 * Returns `rec` itself when there is nothing to drop.
 */
export function slimRecord(rec: GameRecord): GameRecord {
  if (!rec.turnStates || rec.turnStates.length <= 1) return rec;
  const slim: GameRecord = { ...rec, turnStates: rec.turnStates.slice(0, 1) };
  if (!slim.checkpoint) {
    let ends = 0;
    let lastEnd = -1;
    rec.steps.forEach((st, i) => {
      if (st.a.type === "endTurn") {
        ends++;
        lastEnd = i;
      }
    });
    if (ends === rec.turnStates.length - 1) slim.checkpoint = { step: lastEnd + 1, state: rec.turnStates[rec.turnStates.length - 1] };
  }
  return slim;
}

/** the position after the last move: from the checkpoint when there is one, else by a full replay */
export function latestState(rec: GameRecord): GameState {
  const c = rec.checkpoint;
  if (c && c.step >= 0 && c.step <= rec.steps.length) {
    try {
      let s = cloneState(c.state);
      for (let i = c.step; i < rec.steps.length; i++) s = applyAction(s, rec.steps[i].a);
      return s;
    } catch {
      // a checkpoint the current rules cannot continue from: fall back to the full replay
    }
  }
  return replay(rec).states.pop()!;
}

/**
 * The end of a record as a record of its own, for watching a game live: it starts at the checkpoint
 * and holds only the moves since, so opening it costs the same however long the game already is.
 * `base` says how many moves came before. Without a checkpoint it is the whole record (base 0).
 */
export function liveWindow(rec: GameRecord): GameRecord {
  const c = rec.checkpoint;
  if (!c || c.step <= 0 || c.step > rec.steps.length) return { ...rec, base: 0 };
  return { ...rec, turnStates: [c.state], steps: rec.steps.slice(c.step), checkpoint: undefined, base: c.step };
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
