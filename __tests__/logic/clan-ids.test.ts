import { LEGACY_CLAN_IDS, migrateClanIds } from "@/logic/arena/record";
import { CLANS } from "@/logic/engine/data";

describe("tribe ids", () => {
  it("every legacy id maps to a current tribe id", () => {
    const ids = new Set(CLANS.map((c) => c.id as string));
    for (const v of Object.values(LEGACY_CLAN_IDS)) expect(ids.has(v)).toBe(true);
    for (const k of Object.keys(LEGACY_CLAN_IDS)) expect(ids.has(k)).toBe(false);
  });

  it("migrates clan fields in a saved record, also inside turn snapshots, and nothing else", () => {
    const rec = {
      options: { clans: ["sumerians", "aquarion"], explicitClans: ["spartans"] },
      seats: [{ kind: "model", modelId: "greedy-v1", clan: "inca" }],
      turnStates: [{ players: [{ clan: "romans" }, { clan: "polaris" }] }],
      note: "romans",
    };
    migrateClanIds(rec);
    expect(rec.options.clans).toEqual(["zebasi", "aquarion"]);
    expect(rec.options.explicitClans).toEqual(["quetzali"]);
    expect(rec.seats[0].clan).toBe("xinxi");
    expect(rec.turnStates[0].players.map((p) => p.clan)).toEqual(["imperius", "polaris"]);
    expect(rec.note).toBe("romans");
  });
});
