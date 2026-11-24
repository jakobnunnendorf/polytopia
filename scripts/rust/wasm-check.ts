/**
 * Checks the WebAssembly build of the Rust engine against the Node addon, in
 * Node, through the same code path the browser uses (logic/engine/rust.ts
 * initRustEngine: WebAssembly.instantiate on the module's bytes).
 *
 * For a few games: play them with the native addon (createGame, then each
 * step legalActions and applyAction of a seeded pick), then replay every step
 * on the WebAssembly module and require identical JSON results.
 *
 *   cd engine && cargo build --release -p polywasm --target wasm32-unknown-unknown \
 *     --config profile.release.debug=0 --config profile.release.strip=true
 *   node -r sucrase/register scripts/rust/wasm-check.ts [path/to/polywasm.wasm] [games] [steps]
 */
import { readFileSync } from "fs";
import { join } from "path";
import { call, initRustEngine } from "../../logic/engine/rust";
import { createRng } from "../../logic/engine/rng";

const wasmPath = process.argv[2] || join(__dirname, "../../engine/target/wasm32-unknown-unknown/release/polywasm.wasm");
const GAMES = Number(process.argv[3] ?? 4);
const STEPS = Number(process.argv[4] ?? 300);

type Step = { name: string; args: unknown[]; out: string };

const MODES = ["domination", "perfection", "glory", "might"];
const MAPS = ["drylands", "lakes", "continents", "archipelago"];

/** play with whatever backend `call` currently uses, recording every call */
function play(g: number): Step[] {
  const steps: Step[] = [];
  const rec = (name: string, ...args: unknown[]) => {
    const out = call(name, ...args);
    steps.push({ name, args, out: JSON.stringify(out) });
    return out;
  };
  const rng = createRng(1000 + g);
  const opts = { players: 2 + (g % 3), mode: MODES[g % MODES.length], seed: 77 + g, mapType: MAPS[g % MAPS.length] };
  let s = rec("createGame", opts);
  for (let i = 0; i < STEPS && !s.over; i++) {
    const acts = rec("legalActions", s);
    // mostly the bot's pick, sometimes a random legal action
    const a = rng.next() < 0.7 ? rec("botStep", s, null) : acts[rng.int(0, acts.length - 1)];
    s = rec("applyAction", s, a);
  }
  rec("observe", s, 0);
  rec("scoreOf", s, 0);
  return steps;
}

async function main() {
  const native = Array.from({ length: GAMES }, (_, g) => play(g));
  await initRustEngine(readFileSync(wasmPath));
  let calls = 0;
  for (let g = 0; g < GAMES; g++) {
    for (const st of native[g]) {
      const out = JSON.stringify(call(st.name, ...st.args));
      calls++;
      if (out !== st.out) {
        console.error(`game ${g}: ${st.name} differs between the addon and WebAssembly`);
        console.error(`  native: ${st.out.slice(0, 300)}`);
        console.error(`  wasm:   ${out.slice(0, 300)}`);
        process.exit(1);
      }
    }
  }
  // errors come through as thrown Errors on both paths
  let threw = "";
  try {
    call("applyAction", call("createGame", { players: 2, mode: "domination", seed: 1 }), { type: "move", unitId: -1, to: { x: 0, y: 0 } });
  } catch (e) {
    threw = (e as Error).message;
  }
  if (!threw) {
    console.error("an illegal action did not throw on WebAssembly");
    process.exit(1);
  }
  const steps = native.map((n) => n.filter((s) => s.name === "applyAction").length);
  console.log(`ok: ${GAMES} games (${steps.join(", ")} actions), ${calls} calls equal on the addon and WebAssembly; illegal action throws "${threw}"`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
