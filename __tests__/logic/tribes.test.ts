import { CLANS } from "../../logic/engine/data";
import { tribeDescription } from "../../logic/engine/tribes";

describe("tribe descriptions on the new-game screen", () => {
  it("describe every tribe", () => {
    for (const c of CLANS) {
      const d = tribeDescription(c.id);
      expect(d.start).toMatch(/^Starts with /);
      expect(d.character.length).toBeGreaterThan(10);
    }
  });

  it("read the start from the engine data", () => {
    expect(tribeDescription("hoodrick").start).toBe("Starts with Archery, an Archer and 7★.");
    expect(tribeDescription("luxidoor").start).toBe("Starts with no tech, a Warrior, 2★ and a level 3 capital.");
    expect(tribeDescription("polaris").start).toBe("Starts with Frostwork, a Mooni and 5★.");
  });
});
