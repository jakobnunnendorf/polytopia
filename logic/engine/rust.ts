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
  // the addon's path: env override, else <repo root>/engine/node/polyengine.node, where the
  // repo root is found from this file (scripts, jest) or the working directory (bundled
  // code, e.g. the web app's server-side render, whose __dirname is the bundler's)
  const override = process.env.POLYENGINE_NODE;
  const fromFile =
    typeof __dirname === "string" && /[\\/]logic[\\/]engine$/.test(__dirname)
      ? __dirname.replace(/[\\/]logic[\\/]engine$/, "") + "/engine/node/polyengine.node"
      : null;
  const candidates = override ? [override] : [fromFile, process.cwd() + "/engine/node/polyengine.node"].filter((f): f is string => !!f);
  const mod: { exports: { call?: RawCall } } = { exports: {} };
  let file = candidates[0];
  const errors: string[] = [];
  for (const f of candidates) {
    try {
      (process as unknown as { dlopen(m: object, f: string): void }).dlopen(mod, f);
      file = f;
      errors.length = 0;
      break;
    } catch (e) {
      errors.push(`${f}: ${(e as Error).message}`);
    }
  }
  if (errors.length) throw new Error(`Rust engine addon not loadable (${errors.join("; ")}); ${BUILD_HINT}`);
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

/**
 * A constant (object or array) the Rust engine owns, e.g. DEFAULT_WEIGHTS.
 * Where the engine is reachable at once (Node addon, or WebAssembly already
 * loaded) this is the plain value. In the browser, modules are imported before
 * initRustEngine() has finished, so there it is a stand-in that fetches the
 * value on first use (property access, spread, JSON, Object.keys, identity).
 */
export function engineConstant<T extends object>(name: string, build: (v: T) => T = (v) => v): T {
  if (raw || isNode()) return build(call<T>(name));
  let value: T | null = null;
  const get = (): T => (value ??= build(call<T>(name)));
  // an array target keeps Array.isArray true for array constants
  const target = (name === "CHANNELS" || name.endsWith("_TYPES") || name.endsWith("_IDS") || name.endsWith("_FACTORS") ? [] : {}) as T;
  return new Proxy(target, {
    get: (_, k) => {
      const v = get() as Record<string | symbol, unknown>;
      const x = v[k];
      return typeof x === "function" ? (x as (...a: unknown[]) => unknown).bind(v) : x;
    },
    has: (_, k) => k in get(),
    ownKeys: () => Reflect.ownKeys(get()),
    getOwnPropertyDescriptor: (_, k) => {
      const d = Reflect.getOwnPropertyDescriptor(get(), k);
      // a proxy may not report a property as non-configurable unless the target has it so
      if (d && !Reflect.getOwnPropertyDescriptor(target, k)) d.configurable = true;
      return d;
    },
    set: (_, k, x) => Reflect.set(get(), k, x),
  });
}

/** call engine/api `name` with the TypeScript arguments; returns the parsed result */
export function call<T = any>(name: string, ...args: unknown[]): T {
  const out = JSON.parse(backend()(name, JSON.stringify(args)));
  if ("error" in out) throw new Error(out.error);
  return out.ok as T;
}
