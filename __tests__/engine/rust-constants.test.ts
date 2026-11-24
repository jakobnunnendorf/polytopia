/**
 * Engine constants on the TypeScript side: the ones fetched from Rust, and the
 * stand-in the browser gets before the WebAssembly engine has loaded.
 */
import { call, engineConstant } from "@/logic/engine/rust";
import { PEACEFUL_TURNS } from "@/logic/engine/opinion";
import { DEFAULT_WEIGHTS } from "@/logic/engine/bot";

test("PEACEFUL_TURNS (a TypeScript literal) equals the Rust constant", () => {
  expect(PEACEFUL_TURNS).toBe(call("PEACEFUL_TURNS"));
});

describe("the lazy stand-in (browser before initRustEngine)", () => {
  // make engineConstant believe it runs in a browser: no Node, engine not loaded
  const withoutNode = <T>(f: () => T): T => {
    const versions = process.versions;
    Object.defineProperty(process, "versions", { value: {}, configurable: true });
    try {
      return f();
    } finally {
      Object.defineProperty(process, "versions", { value: versions, configurable: true });
    }
  };

  test("an object constant behaves like the value once used", () => {
    const lazy = withoutNode(() => engineConstant<typeof DEFAULT_WEIGHTS>("DEFAULT_WEIGHTS"));
    expect(lazy.move).toBe(DEFAULT_WEIGHTS.move);
    expect({ ...lazy }).toEqual(DEFAULT_WEIGHTS);
    expect(JSON.stringify(lazy)).toBe(JSON.stringify(DEFAULT_WEIGHTS));
    expect(Object.keys(lazy)).toEqual(Object.keys(DEFAULT_WEIGHTS));
    expect("rewards" in lazy).toBe(true);
  });

  test("an array constant stays an array", () => {
    const lazy = withoutNode(() => engineConstant<string[]>("CHANNELS"));
    const real = call<string[]>("CHANNELS");
    expect(Array.isArray(lazy)).toBe(true);
    expect(lazy.length).toBe(real.length);
    expect([...lazy]).toEqual(real);
    expect(lazy.indexOf(real[3])).toBe(3);
  });
});
