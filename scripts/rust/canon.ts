/**
 * Canonical form of engine values, shared by the TypeScript trace tools and
 * mirrored exactly by engine/core/src/canon.rs.
 *
 * Rules: object keys sorted; an entry whose value is undefined, null, false or
 * an empty array is left out (so "absent" and the default compare equal);
 * array elements are kept as they are; numbers as JSON.stringify writes them.
 * The game log is not part of the state's canonical form.
 */
import crypto from "node:crypto";
import type { Action, GameState } from "../../logic/engine/types";

export function canon(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return JSON.stringify(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const x = o[k];
    if (x === undefined || x === null || x === false) continue;
    if (Array.isArray(x) && x.length === 0) continue;
    parts.push(JSON.stringify(k) + ":" + canon(x));
  }
  return "{" + parts.join(",") + "}";
}

export function canonState(s: GameState): string {
  const { log: _log, ...rest } = s;
  return canon(rest);
}

export const md5 = (x: string) => crypto.createHash("md5").update(x).digest("hex");

/** 16 hex chars are plenty to tell two states apart in a test */
export const stateHash = (s: GameState) => md5(canonState(s)).slice(0, 16);
export const actionsHash = (a: Action[]) => md5(canon(a)).slice(0, 16);
