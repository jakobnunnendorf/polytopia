/**
 * Shardlands display names. The engine uses plain descriptive ids
 * ("warrior", "climbing"); players see the names below. Purely cosmetic:
 * changing a name here never changes a rule.
 */
import type { Action, GameState } from "./types";
import { BUILDS } from "./data";

type Kind = "tech" | "unit" | "building" | "terrain" | "resource" | "clan" | "reward" | "ability";

const NAMES: Record<Kind, Record<string, string>> = {
  tech: {
    // riding branch
    riding: "Beastcalling",
    roads: "Wayfinding",
    freeSpirit: "Wanderlust",
    trade: "Barter",
    chivalry: "Lancecraft",
    // organization branch
    organization: "Foraging",
    farming: "Tilling",
    strategy: "Bulwarks",
    construction: "Masonry",
    diplomacy: "Envoys",
    // climbing branch
    climbing: "Cragwalking",
    mining: "Delving",
    meditation: "Stillness",
    smithery: "Forgecraft",
    philosophy: "Insight",
    // hunting branch
    hunting: "Tracking",
    archery: "Fletching",
    forestry: "Woodlore",
    spiritualism: "Rootsong",
    mathematics: "Siegecraft",
    // fishing branch
    fishing: "Netweaving",
    sailing: "Windsails",
    ramming: "Prowcraft",
    navigation: "Starcharts",
    aquatism: "Tidebond",
  },
  unit: {
    warrior: "Brawler",
    rider: "Outrider",
    archer: "Slinger",
    defender: "Shieldbearer",
    swordsman: "Blademaster",
    catapult: "Trebuchet",
    knight: "Lancer",
    giant: "Colossus",
    mindBender: "Whisperer",
    explorer: "Pathfinder",
    cloak: "Shade",
    dagger: "Cutthroat",
    raft: "Skiff",
    scout: "Sloop",
    rammer: "Ironprow",
    bomber: "Mortar Barge",
    juggernaut: "Leviathan",
    dinghy: "Shade Skiff",
    pirate: "Corsair",
  },
  building: {
    farm: "Field Plot",
    mine: "Delve",
    lumberHut: "Woodcutter",
    sawmill: "Timberyard",
    windmill: "Grainmill",
    forge: "Smeltery",
    port: "Harbor",
    market: "Bazaar",
    temple: "Shrine",
    forestTemple: "Grove Shrine",
    waterTemple: "Tide Shrine",
    mountainTemple: "Peak Shrine",
    customsHouse: "Tollhouse",
    embassy: "Envoy Lodge",
    monument: "Wonder",
    road: "Road",
    bridge: "Bridge",
    park: "Garden",
    destroy: "Demolish",
    harvestFruit: "Gather berries",
    hunt: "Hunt deer",
    fish: "Catch fish",
    clearForest: "Clear woods (+1 ◆)",
    burnForest: "Burn woods",
    growForest: "Grow woods",
    altarOfPeace: "Stone of Calm",
    towerOfWisdom: "Lore Spire",
    emperorsTomb: "Gilded Vault",
    gateOfPower: "Warden Arch",
    parkOfFortune: "Garden of Plenty",
    grandBazaar: "Crossroads Fair",
    eyeOfGod: "Beacon Crown",
  },
  terrain: {
    field: "Meadow",
    forest: "Woods",
    mountain: "Crag",
    water: "Shallows",
    ocean: "Deep sea",
  },
  resource: {
    fruit: "Berries",
    crop: "Wild grain",
    animal: "Deer",
    fish: "Fish",
    metal: "Ore",
    starfish: "Sea shard",
  },
  clan: {
    inca: "Inca",
    romans: "Romans",
    norse: "Norse",
    mongols: "Mongols",
    polynesians: "Polynesians",
    welsh: "Welsh",
    lydians: "Lydians",
    hittites: "Hittites",
    sumerians: "Sumerians",
    tibetans: "Tibetans",
    spartans: "Spartans",
    persians: "Persians",
  },
  reward: {
    workshop: "Workshop (+1 ◆ per turn)",
    explorer: "Pathfinder (scouts the map)",
    cityWall: "City wall",
    resources: "Stockpile (+5 ◆)",
    populationGrowth: "Growth (+3 pop)",
    borderGrowth: "Wider borders",
    park: "Garden (+score)",
    superUnit: "Colossus",
  },
  ability: {},
};

function humanize(id: string) {
  return id
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

export function name(kind: Kind, id: string): string {
  return NAMES[kind][id] ?? humanize(id);
}

export const CLAN_IDS = Object.keys(NAMES.clan);

/** Short button label for an action. */
export function actionLabel(_s: GameState, a: Action): string {
  switch (a.type) {
    case "endTurn":
      return "End turn";
    case "research":
      return `Learn ${name("tech", a.tech)}`;
    case "move":
      return `Move to ${a.to.x},${a.to.y}`;
    case "attack":
      return "Attack";
    case "capture":
      return "Claim";
    case "recover":
      return "Rest";
    case "examine":
      return "Search ruin";
    case "disband":
      return "Disband";
    case "upgrade":
      return `Refit: ${name("unit", a.to)}`;
    case "promote":
      return "Promote (veteran)";
    case "healOthers":
      return "Mend allies";
    case "harvestStarfish":
      return "Gather sea shard (+8 ◆)";
    case "infiltrate":
      return "Infiltrate";
    case "train":
      return `Train ${name("unit", a.unit)}`;
    case "build": {
      const kind = BUILDS[a.building]?.kind;
      const verb = kind === "harvest" || kind === "destroy" ? "" : "Build ";
      return `${verb}${name("building", a.building)}`;
    }
    case "reward":
      return name("reward", a.reward);
  }
}
