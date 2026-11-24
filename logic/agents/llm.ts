/**
 * Simplest possible LLM opponent: for every decision, describe the position in
 * a few lines, list a short menu of candidate moves (pre-ranked by the greedy
 * heuristic so the menu stays small), and ask the model for one number.
 * Anything unparseable or unreachable falls back to the fallback model.
 */
import { legalActions } from "../engine/actions";
import { DEFAULT_WEIGHTS, scoreAction } from "../engine/bot";
import { actionLabel, name } from "../engine/names";
import { income, scoreOf, techCost } from "../engine/state";
import type { Action, GameState } from "../engine/types";
import type { Agent, ChatFn, ModelSpec } from "./types";

export const SYSTEM_PROMPT = `You play The Battle of Polytopia, a turn-based 4X strategy game on a square grid.
Each turn you spend stars (currency) on techs, units and buildings, and move units.
Grow cities (harvest resources next to them), capture villages and enemy cities, and keep your units alive.
You are given the position and a numbered list of legal moves.
Answer with only the number of the move you choose. Choose "end turn" when nothing useful is left.`;

/** candidate menu: end turn + the top-N actions by the greedy heuristic (ties kept stable) */
export function candidates(s: GameState, max: number): Action[] {
  const all = legalActions(s);
  if (all.length > 0 && all[0].type === "reward") return all;
  const scored = all
    .filter((a) => a.type !== "endTurn")
    .map((a, i) => ({ a, i, sc: scoreAction(s, a, DEFAULT_WEIGHTS) }))
    .sort((x, y) => y.sc - x.sc || x.i - y.i)
    .slice(0, Math.max(1, max - 1))
    .map((x) => x.a);
  return [{ type: "endTurn" }, ...scored];
}

export function describe(s: GameState): string {
  const p = s.current;
  const me = s.players[p];
  const cities = s.cities.filter((c) => c.owner === p);
  const units = s.units.filter((u) => u.owner === p);
  const rivals = s.players.filter((o) => o.id !== p && o.alive);
  const lines = [
    `Turn ${s.turn}${
      s.mode === "perfection"
        ? ` of ${s.maxTurns} (highest score wins)`
        : s.mode === "glory"
          ? " (first to 10,000 points wins)"
          : s.mode === "might"
            ? " (capture every capital to win)"
            : " (last tribe with a city wins)"
    }.`,
    `You are the ${name("clan", me.clan)}. Stars: ${me.stars} (+${income(s, p)} per turn). Score: ${scoreOf(s, p)}.`,
    `Your cities: ${cities.map((c) => `${c.name} level ${c.level} (${c.pop}/${c.level + 1} people) at ${c.x},${c.y}`).join("; ") || "none"}.`,
    `Your units: ${units.map((u) => `${name("unit", u.type)} ${Math.ceil(u.hp)}hp at ${u.x},${u.y}`).join("; ") || "none"}.`,
    `Techs known: ${me.techs.map((t) => name("tech", t, me.clan)).join(", ") || "none"}.`,
    `Rivals: ${rivals.map((o) => `${name("clan", o.clan)} score ${scoreOf(s, o.id)}`).join("; ")}.`,
  ];
  return lines.join("\n");
}

export function labelFor(s: GameState, a: Action): string {
  if (a.type === "endTurn") return "end turn";
  if (a.type === "research") return `research ${name("tech", a.tech, s.players[s.current].clan)} (${techCost(s, s.current, a.tech)} stars)`;
  if (a.type === "move" || a.type === "attack") {
    const u = s.units.find((x) => x.id === a.unitId);
    const where = u ? ` from ${u.x},${u.y}` : "";
    if (a.type === "move") return `move ${u ? name("unit", u.type) : "unit"}${where} to ${a.to.x},${a.to.y}`;
    const t = s.units.find((x) => x.id === a.targetId);
    return `attack with ${u ? name("unit", u.type) : "unit"}${where} the ${t ? name("unit", t.type) : "enemy"} at ${t?.x},${t?.y}`;
  }
  if (a.type === "build") return `${actionLabel(s, a).toLowerCase()} at ${a.at.x},${a.at.y}`;
  return actionLabel(s, a).toLowerCase();
}

export function parseChoice(text: string, n: number): number | null {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  const m = cleaned.match(/\d+/);
  if (!m) return null;
  const k = Number(m[0]);
  return k >= 0 && k < n ? k : null;
}

export function llmAgent(spec: ModelSpec, chat: ChatFn, fallback: Agent): Agent {
  const cfg = spec.llm!;
  const stats = { decisions: 0, byModel: 0, fallbacks: 0, lastError: "" };
  const debug = typeof process !== "undefined" && !!process.env?.SHARDLANDS_LLM_DEBUG;
  return {
    spec,
    stats,
    async act(s) {
      const menu = candidates(s, cfg.maxCandidates ?? 24);
      if (menu.length === 1) return menu[0];
      stats.decisions++;
      const prompt = `${describe(s)}\n\nLegal moves:\n${menu.map((a, i) => `${i}. ${labelFor(s, a)}`).join("\n")}\n\nYour move number:`;
      try {
        const reply = await chat({
          endpoint: cfg.endpoint,
          model: cfg.model,
          temperature: cfg.temperature ?? 0.2,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
        });
        const k = parseChoice(reply, menu.length);
        if (debug) console.log(`[llm] ${JSON.stringify(reply)} -> ${k === null ? "fallback" : labelFor(s, menu[k])}`);
        if (k !== null) {
          stats.byModel++;
          return menu[k];
        }
        stats.lastError = `unusable answer ${JSON.stringify(reply.slice(0, 40))}`;
      } catch (e) {
        // unreachable model: fall through to the fallback policy
        stats.lastError = String((e as Error).message ?? e);
        if (debug) console.log(`[llm] error ${stats.lastError}`);
      }
      stats.fallbacks++;
      return fallback.act(s);
    },
  };
}
