import { CLANS, rewardOptions } from "../../logic/engine/data";
import { rewardDescription } from "../../logic/engine/rewards";

describe("level-up reward descriptions", () => {
  it("explain every reward the engine can offer", () => {
    for (const level of [2, 3, 4, 5]) for (const r of rewardOptions(level)) expect(rewardDescription(r).length).toBeGreaterThan(10);
  });

  it("name each tribe's own super unit", () => {
    expect(rewardDescription("superUnit", "imperius")).toMatch(/^A Giant \(40 HP, 5 ATK, 4 DEF\)/);
    for (const c of CLANS.filter((c) => c.superUnit)) expect(rewardDescription("superUnit", c.id)).not.toMatch(/Giant/);
  });
});
