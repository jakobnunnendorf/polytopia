import { computeDamage } from "@/logic/engine/combat";
import { TECHS, UNITS, techCostFor } from "@/logic/engine/data";

describe("damage formula (wiki Combat page)", () => {
  it("warrior vs full-health warrior on open ground: 5 damage, then 3 back", () => {
    const hit = computeDamage(2, 10, 10, 2, 10, 10, 1);
    expect(hit.damage).toBe(5);
    // retaliation is computed with the defender's HP after the hit
    const back = computeDamage(2, 10, 10, 2, 5, 10, 1);
    expect(back.retaliation).toBe(3);
  });

  it("defence bonus multiplies defence force, not the retaliation stat", () => {
    // 2-defence unit with 1.5 bonus takes the same damage as a 3-defence unit
    const withBonus = computeDamage(3, 10, 10, 2, 10, 10, 1.5);
    const threeDef = computeDamage(3, 10, 10, 3, 10, 10, 1);
    expect(withBonus.damage).toBe(threeDef.damage);
  });

  it("city wall bonus of 4 makes a defender very hard to hurt", () => {
    const r = computeDamage(2, 10, 10, 3, 15, 15, 4);
    // attackForce 2, defenceForce 12 -> round(2/14*2*4.5) = 1
    expect(r.damage).toBe(1);
  });

  it("damaged attackers deal less", () => {
    const full = computeDamage(2, 10, 10, 2, 10, 10, 1).damage;
    const half = computeDamage(2, 5, 10, 2, 10, 10, 1).damage;
    expect(half).toBeLessThan(full);
  });
});

describe("unit stats (wiki infoboxes)", () => {
  it.each([
    ["warrior", 2, 10, 2, 2, 1, 1],
    ["rider", 3, 10, 2, 1, 2, 1],
    ["archer", 3, 10, 2, 1, 1, 2],
    ["defender", 3, 15, 1, 3, 1, 1],
    ["swordsman", 5, 15, 3, 3, 1, 1],
    ["catapult", 8, 10, 4, 0, 1, 3],
    ["knight", 8, 10, 3.5, 1, 3, 1],
    ["mindBender", 5, 10, 0, 1, 1, 1],
    ["cloak", 8, 5, 2, 0.5, 2, 1],
  ])("%s costs %i, hp %i, atk %d, def %d, move %i, range %i", (id, cost, hp, atk, def, mv, rng) => {
    const u = UNITS[id as string];
    expect([u.cost, u.hp, u.attack, u.defence, u.movement, u.range]).toEqual([
      cost,
      hp,
      atk,
      def,
      mv,
      rng,
    ]);
  });

  it("giant is a 40 HP super unit with 5/4", () => {
    expect(UNITS.giant).toMatchObject({ hp: 40, attack: 5, defence: 4, movement: 1 });
  });
});

describe("tech tree (wiki Technology page)", () => {
  it("has 25 techs: 5 branches of 1 + 2 + 2", () => {
    expect(TECHS).toHaveLength(25);
    expect(TECHS.filter((t) => t.tier === 1)).toHaveLength(5);
    expect(TECHS.filter((t) => t.tier === 2)).toHaveLength(10);
    expect(TECHS.filter((t) => t.tier === 3)).toHaveLength(10);
    for (const t of TECHS) {
      if (t.tier === 1) expect(t.parent).toBeNull();
      else expect(TECHS.find((p) => p.id === t.parent)?.tier).toBe(t.tier - 1);
    }
  });

  // rows of the wiki "Technology Costs" table: [cities, t1, t1lit, t2, t2lit, t3, t3lit]
  it.each([
    [0, 4, 3, 4, 3, 4, 3],
    [1, 5, 4, 6, 4, 7, 5],
    [2, 6, 4, 8, 6, 10, 7],
    [3, 7, 5, 10, 7, 13, 9],
    [5, 9, 6, 14, 10, 19, 13],
    [8, 12, 8, 20, 14, 28, 19],
    [13, 17, 12, 30, 20, 43, 29],
    [36, 40, 27, 76, 51, 112, 75],
  ])("cost with %i cities", (cities, t1, t1l, t2, t2l, t3, t3l) => {
    expect(techCostFor(1, cities, false)).toBe(t1);
    expect(techCostFor(1, cities, true)).toBe(t1l);
    expect(techCostFor(2, cities, false)).toBe(t2);
    expect(techCostFor(2, cities, true)).toBe(t2l);
    expect(techCostFor(3, cities, false)).toBe(t3);
    expect(techCostFor(3, cities, true)).toBe(t3l);
  });
});
