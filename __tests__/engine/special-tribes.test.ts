import { applyAction, legalActions } from "@/logic/engine/actions";
import { playBotTurn } from "@/logic/engine/bot";
import { CLANS, UNITS, buildAllowedFor, superUnitFor, trainableUnitsFor } from "@/logic/engine/data";
import { defenceBonus } from "@/logic/engine/combat";
import { createGame } from "@/logic/engine/state";

describe("All 16 Polytopia tribes", () => {
  it("defines all 16 tribes (12 regular + 4 special)", () => {
    expect(CLANS).toHaveLength(16);
    const specials = CLANS.filter((c) => c.special).map((c) => c.id);
    expect(specials).toEqual(["aquarion", "elyrion", "polaris", "cymanti"]);
  });

  it("maps each special tribe to its super unit and unique trainable roster", () => {
    expect(superUnitFor("aquarion")).toBe("crab");
    expect(superUnitFor("elyrion")).toBe("dragonEgg");
    expect(superUnitFor("polaris")).toBe("gaami");
    expect(superUnitFor("cymanti")).toBe("centipede");
    expect(superUnitFor("imperius")).toBe("giant");

    expect(trainableUnitsFor("aquarion").map((u) => u.id)).toContain("tridention");
    expect(trainableUnitsFor("polaris").map((u) => u.id)).toContain("mooni");
    expect(trainableUnitsFor("cymanti").map((u) => u.id)).toContain("hexapod");
    expect(trainableUnitsFor("imperius").map((u) => u.id)).not.toContain("hexapod");
  });

  it("enforces Elyrion forest protection and enchantAnimal build", () => {
    expect(buildAllowedFor("elyrion", "enchantAnimal")).toBe(true);
    expect(buildAllowedFor("elyrion", "sanctuary")).toBe(true);
    expect(buildAllowedFor("elyrion", "clearForest")).toBe(false);
    expect(buildAllowedFor("elyrion", "burnForest")).toBe(false);
    expect(buildAllowedFor("imperius", "enchantAnimal")).toBe(false);
  });

  it("Polaris Mooni auto-freezes adjacent water after moving (no Freeze Area action)", () => {
    const s = createGame({ mapSize: 11, players: 2, mode: "domination", seed: 7, clans: ["polaris", "imperius"] });
    const mooni = s.units.find((u) => u.owner === 0)!;
    expect(mooni.type).toBe("mooni");
    const acts = legalActions(s);
    expect(acts.some((a) => a.type === "freezeArea" && a.unitId === mooni.id)).toBe(false);
    const move = acts.find((a) => a.type === "move" && a.unitId === mooni.id);
    expect(move).toBeTruthy();
    const to = (move as { to: { x: number; y: number } }).to;
    const n = s.mapSize;
    s.tiles[(to.y) * n + Math.min(n - 1, to.x + 1)].terrain = "water";
    const next = applyAction(s, move!);
    expect(next.tiles[to.y * n + Math.min(n - 1, to.x + 1)].ice).toBe(true);
  });

  it("Cymanti poison halves defence bonuses (1->0.5, 1.5->0.7, 4->2)", () => {
    const s = createGame({ mapSize: 11, players: 2, mode: "domination", seed: 11, clans: ["cymanti", "imperius"] });
    const u = s.units[1];
    u.poisoned = true;
    expect(defenceBonus(s, u)).toBe(0.7); // in own capital (1.5 -> 0.7)
  });

  it("bots can play multi-turn games with all 4 special tribes without crashing", () => {
    let s = createGame({
      mapSize: 14,
      players: 4,
      mode: "perfection",
      seed: 42,
      clans: ["aquarion", "elyrion", "polaris", "cymanti"],
    });
    for (let i = 0; i < 16 && !s.over; i++) {
      s = playBotTurn(s);
    }
    expect(s.turn).toBeGreaterThanOrEqual(3);
    expect(UNITS.fireDragon.attack).toBe(4);
  });
});
