/**
 * Battle of Polytopia display names. The engine uses plain descriptive ids
 * ("warrior", "climbing"); players see the standard Polytopia names below.
 * Purely cosmetic: changing a name here never changes a rule.
 */
import type { Action, GameState } from "./types";
import { BUILDS } from "./data";

type Kind = "tech" | "unit" | "building" | "terrain" | "resource" | "clan" | "reward" | "ability";

const NAMES: Record<Kind, Record<string, string>> = {
  tech: {
    // riding branch
    riding: "Riding",
    roads: "Roads",
    freeSpirit: "Free Spirit",
    trade: "Trade",
    chivalry: "Chivalry",
    // organization branch
    organization: "Organization",
    farming: "Farming",
    strategy: "Strategy",
    construction: "Construction",
    diplomacy: "Diplomacy",
    // climbing branch
    climbing: "Climbing",
    mining: "Mining",
    meditation: "Meditation",
    smithery: "Smithery",
    philosophy: "Philosophy",
    // hunting branch
    hunting: "Hunting",
    archery: "Archery",
    forestry: "Forestry",
    spiritualism: "Spiritualism",
    mathematics: "Mathematics",
    // fishing branch
    fishing: "Fishing",
    sailing: "Sailing",
    ramming: "Ramming",
    navigation: "Navigation",
    aquatism: "Aquatism",
  },
  unit: {
    warrior: "Warrior",
    rider: "Rider",
    archer: "Archer",
    defender: "Defender",
    swordsman: "Swordsman",
    catapult: "Catapult",
    knight: "Knight",
    giant: "Giant",
    mindBender: "Mind Bender",
    explorer: "Explorer",
    cloak: "Cloak",
    dagger: "Dagger",
    raft: "Raft",
    scout: "Scout",
    rammer: "Rammer",
    bomber: "Bomber",
    juggernaut: "Juggernaut",
    dinghy: "Dinghy",
    pirate: "Pirate",
    // Aquarion
    mermaid: "Mermaid",
    amphibian: "Amphibian",
    shark: "Shark",
    jelly: "Jelly",
    puffer: "Puffer",
    tridention: "Tridention",
    crab: "Crab",
    mermaidArcher: "Mermaid Archer",
    mermaidDefender: "Mermaid Defender",
    swordsmaid: "Swordsmaid",
    siren: "Siren",
    scuba: "Scuba",
    mermaidDagger: "Mermaid Dagger",
    // Elyrion
    polytaur: "Polytaur",
    dragonEgg: "Dragon Egg",
    babyDragon: "Baby Dragon",
    fireDragon: "Fire Dragon",
    // Polaris
    mooni: "Mooni",
    iceArcher: "Ice Archer",
    battleSled: "Battle Sled",
    iceFortress: "Ice Fortress",
    gaami: "Gaami",
    // Cymanti
    shaman: "Shaman",
    hexapod: "Hexapod",
    kiton: "Kiton",
    phychi: "Phychi",
    mantis: "Mantis",
    moth: "Moth",
    raychi: "Raychi",
    boomchi: "Boomchi",
    exida: "Exida",
    doomux: "Doomux",
    livingIsland: "Living Island",
    centipede: "Centipede",
    segment: "Segment",
    insectEgg: "Insect Egg",
    larva: "Larva",
  },
  building: {
    farm: "Farm",
    mine: "Mine",
    lumberHut: "Lumber Hut",
    sawmill: "Sawmill",
    windmill: "Windmill",
    forge: "Forge",
    port: "Port",
    market: "Market",
    temple: "Temple",
    forestTemple: "Forest Temple",
    waterTemple: "Water Temple",
    iceTemple: "Ice Temple",
    mountainTemple: "Mountain Temple",
    customsHouse: "Customs House",
    embassy: "Embassy",
    monument: "Monument",
    road: "Road",
    bridge: "Bridge",
    park: "Park",
    destroy: "Destroy",
    harvestFruit: "Harvest Fruit",
    hunt: "Hunt Animal",
    fish: "Fishing",
    clearForest: "Clear Forest (+1 ★)",
    burnForest: "Burn Forest",
    growForest: "Grow Forest",
    altarOfPeace: "Altar of Peace",
    towerOfWisdom: "Tower of Wisdom",
    emperorsTomb: "Emperor's Tomb",
    gateOfPower: "Gate of Power",
    parkOfFortune: "Park of Fortune",
    grandBazaar: "Grand Bazaar",
    eyeOfGod: "Eye of God",
    // Special tribe buildings
    enchantAnimal: "Enchant Animal",
    sanctuary: "Sanctuary",
    outpost: "Outpost",
    iceBank: "Ice Bank",
    fungi: "Fungi",
    mycelium: "Mycelium",
    clathrus: "Clathrus",
    canal: "Canal",
    algae: "Algae",
    atoll: "Atoll",
    aquaFarm: "Aqua Farm",
    fertilize: "Fertilize",
  },
  terrain: {
    field: "Field",
    forest: "Forest",
    mountain: "Mountain",
    water: "Water",
    ocean: "Ocean",
  },
  resource: {
    fruit: "Fruit",
    crop: "Crop",
    animal: "Animal",
    fish: "Fish",
    metal: "Metal",
    starfish: "Starfish",
    aquaCrop: "Aqua Crop",
    spores: "Spores",
  },
  clan: {
    xinxi: "Xin-xi",
    imperius: "Imperius",
    bardur: "Bardur",
    oumaji: "Oumaji",
    kickoo: "Kickoo",
    hoodrick: "Hoodrick",
    luxidoor: "Luxidoor",
    vengir: "Vengir",
    zebasi: "Zebasi",
    aimo: "Ai-Mo",
    quetzali: "Quetzali",
    yadakk: "Yădakk",
    aquarion: "Aquarion",
    elyrion: "∑∫ỹriȱŋ",
    polaris: "Polaris",
    cymanti: "Cymanti",
  },
  reward: {
    workshop: "Workshop (+1 ★/turn)",
    explorer: "Explorer (reveals map)",
    cityWall: "City Wall",
    resources: "Resources (+5 ★)",
    populationGrowth: "Population Growth (+3 pop)",
    borderGrowth: "Border Growth",
    park: "Park (+250 pts)",
    superUnit: "Super Unit (Giant)",
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
      return "End Turn";
    case "research":
      return `Research ${name("tech", a.tech)}`;
    case "move":
      return `Move to ${a.to.x},${a.to.y}`;
    case "attack":
      return "Attack";
    case "capture":
      return "Capture";
    case "recover":
      return "Recover";
    case "examine":
      return "Examine";
    case "disband":
      return "Disband";
    case "upgrade":
      return `Upgrade: ${name("unit", a.to)}`;
    case "promote":
      return "Promote";
    case "healOthers":
      return "Heal";
    case "harvestStarfish":
      return "Harvest Starfish (+8 ★)";
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
    case "freezeArea":
      return "Freeze Area";
    case "boost":
      return "Swarm";
    case "explode":
      return "Explode";
    case "breakIce":
      return `Break Ice at ${a.at.x},${a.at.y}`;
    case "drain":
      return a.effect === "flooded" ? "Drain" : "Clear Algae";
    case "decompose":
      return "Decompose";
    case "offerPeace":
      return `Offer Peace to ${tribeName(_s, a.player)}`;
    case "acceptPeace":
      return `Accept Peace from ${tribeName(_s, a.player)}`;
    case "declinePeace":
      return `Decline Peace from ${tribeName(_s, a.player)}`;
    case "breakPeace":
      return `Break Peace with ${tribeName(_s, a.player)}`;
  }
}

function tribeName(s: GameState, p: number): string {
  const pl = s.players[p];
  return pl ? name("clan", pl.clan) : `player ${p}`;
}
