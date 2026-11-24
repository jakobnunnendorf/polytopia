/**
 * Loader for the Rust engine (engine/), the one entry point `call(name, ...args)`.
 *
 * - Node (scripts, jest): the N-API addon engine/node/polyengine.node, loaded
 *   synchronously on the first call.
 * - Browser: the WebAssembly module (engine/wasm). Call `initRustEngine()` once
 *   before the first engine call; after that `call` is synchronous.
 *
 * `name` is the TypeScript function name and the arguments are passed as JSON
 * in TypeScript order (see engine/api/src/lib.rs). Errors from Rust (illegal
 * actions, bad arguments) throw `Error(msg)`, like the TypeScript engine.
 */

type RawCall = (name: string, argsJson: string) => string;

let raw: RawCall | null = null;

const BUILD_HINT =
  'build it with: cd engine && export PATH="$HOME/.cargo/bin:$PATH" && cargo build --release -p polynode ' +
  "&& cp target/release/libpolynode.dylib node/polyengine.node";

function isNode(): boolean {
  return typeof process !== "undefined" && !!process.versions && typeof process.versions.node === "string";
}

/** the native addon, loaded with process.dlopen (no `require`, so bundlers never see it) */
function loadNative(): RawCall {
  const g = globalThis as { __polyengineNative?: RawCall };
  if (g.__polyengineNative) return g.__polyengineNative;
  // the addon's path: env override, else <repo root>/engine/node/polyengine.node
  const override = process.env.POLYENGINE_NODE;
  const dir = typeof __dirname === "string" ? __dirname : process.cwd() + "/logic/engine";
  const file = override || dir.replace(/[\\/]logic[\\/]engine([\\/]rs)?$/, "") + "/engine/node/polyengine.node";
  const mod: { exports: { call?: RawCall } } = { exports: {} };
  try {
    (process as unknown as { dlopen(m: object, f: string): void }).dlopen(mod, file);
  } catch (e) {
    throw new Error(`Rust engine addon not loadable at ${file} (${(e as Error).message}); ${BUILD_HINT}`);
  }
  const fn = mod.exports.call;
  if (typeof fn !== "function") throw new Error(`Rust engine addon at ${file} exports no call(); ${BUILD_HINT}`);
  g.__polyengineNative = fn;
  return fn;
}

type WasmExports = {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  call(namePtr: number, nameLen: number, argsPtr: number, argsLen: number): number;
};

function wasmCaller(ex: WasmExports): RawCall {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const put = (bytes: Uint8Array) => {
    const p = ex.alloc(bytes.length);
    new Uint8Array(ex.memory.buffer, p, bytes.length).set(bytes);
    return p;
  };
  return (name, argsJson) => {
    const n = enc.encode(name);
    const a = enc.encode(argsJson);
    const np = put(n);
    const ap = put(a);
    const out = ex.call(np, n.length, ap, a.length);
    ex.dealloc(np, n.length);
    ex.dealloc(ap, a.length);
    // views are made after the call: the memory may have grown
    const len = new DataView(ex.memory.buffer).getUint32(out, true);
    const text = dec.decode(new Uint8Array(ex.memory.buffer, out + 4, len));
    ex.dealloc(out, len + 4);
    return text;
  };
}

/**
 * Load the WebAssembly engine; `source` is its URL (browser default
 * "/polyengine.wasm"), its bytes, or a compiled module. After it resolves,
 * every engine call goes to this module (also in Node, for tests).
 */
export async function initRustEngine(source: string | BufferSource | WebAssembly.Module = "/polyengine.wasm"): Promise<void> {
  let instance: WebAssembly.Instance;
  if (source instanceof WebAssembly.Module) {
    instance = await WebAssembly.instantiate(source, {});
  } else {
    const bytes = typeof source === "string" ? await (await fetch(source)).arrayBuffer() : source;
    instance = (await WebAssembly.instantiate(bytes, {})).instance;
  }
  raw = wasmCaller(instance.exports as unknown as WasmExports);
}

function backend(): RawCall {
  if (raw) return raw;
  if (isNode()) return (raw = loadNative());
  if (typeof WebAssembly !== "undefined" && typeof window !== "undefined") {
    throw new Error("Rust engine not loaded yet: await initRustEngine() before the first engine call");
  }
  throw new Error("Rust engine unavailable on this platform (no Node addon, no WebAssembly)");
}

/** call engine/api `name` with the TypeScript arguments; returns the parsed result */
export function call<T = any>(name: string, ...args: unknown[]): T {
  const out = JSON.parse(backend()(name, JSON.stringify(args)));
  if ("error" in out) throw new Error(out.error);
  return out.ok as T;
}
