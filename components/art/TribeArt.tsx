/**
 * Battle of Polytopia 3D flat-shaded isometric PNG sprites for all 16 tribe
 * emblems, all 29 special tribe units, and all 6 special tribe buildings.
 * Purely cosmetic; the engine never imports this file.
 */
import React from "react";
import { Image, type ImageSourcePropType } from "react-native";

const TRIBE_EMBLEMS: Record<string, ImageSourcePropType> = {
  xinxi: require("@/assets/sprites/tribe-xinxi.png"),
  imperius: require("@/assets/sprites/tribe-imperius.png"),
  bardur: require("@/assets/sprites/tribe-bardur.png"),
  oumaji: require("@/assets/sprites/tribe-oumaji.png"),
  kickoo: require("@/assets/sprites/tribe-kickoo.png"),
  hoodrick: require("@/assets/sprites/tribe-hoodrick.png"),
  luxidoor: require("@/assets/sprites/tribe-luxidoor.png"),
  vengir: require("@/assets/sprites/tribe-vengir.png"),
  zebasi: require("@/assets/sprites/tribe-zebasi.png"),
  aimo: require("@/assets/sprites/tribe-aimo.png"),
  quetzali: require("@/assets/sprites/tribe-quetzali.png"),
  yadakk: require("@/assets/sprites/tribe-yadakk.png"),
  aquarion: require("@/assets/sprites/tribe-aquarion.png"),
  elyrion: require("@/assets/sprites/tribe-elyrion.png"),
  polaris: require("@/assets/sprites/tribe-polaris.png"),
  cymanti: require("@/assets/sprites/tribe-cymanti.png"),
};

const SPECIAL_UNIT_SPRITES: Record<string, ImageSourcePropType> = {
  // Aquarion
  mermaid: require("@/assets/sprites/mermaid.png"),
  mermaidArcher: require("@/assets/sprites/mermaidArcher.png"),
  mermaidDefender: require("@/assets/sprites/mermaidDefender.png"),
  swordsmaid: require("@/assets/sprites/swordsmaid.png"),
  siren: require("@/assets/sprites/siren.png"),
  scuba: require("@/assets/sprites/scuba.png"),
  mermaidDagger: require("@/assets/sprites/mermaidDagger.png"),
  amphibian: require("@/assets/sprites/amphibian.png"),
  shark: require("@/assets/sprites/shark.png"),
  jelly: require("@/assets/sprites/jelly.png"),
  puffer: require("@/assets/sprites/puffer.png"),
  tridention: require("@/assets/sprites/tridention.png"),
  crab: require("@/assets/sprites/crab.png"),
  // Elyrion
  polytaur: require("@/assets/sprites/polytaur.png"),
  dragonEgg: require("@/assets/sprites/dragonEgg.png"),
  babyDragon: require("@/assets/sprites/babyDragon.png"),
  fireDragon: require("@/assets/sprites/fireDragon.png"),
  // Polaris
  mooni: require("@/assets/sprites/mooni.png"),
  iceArcher: require("@/assets/sprites/iceArcher.png"),
  battleSled: require("@/assets/sprites/battleSled.png"),
  iceFortress: require("@/assets/sprites/iceFortress.png"),
  gaami: require("@/assets/sprites/gaami.png"),
  // Cymanti
  shaman: require("@/assets/sprites/shaman.png"),
  hexapod: require("@/assets/sprites/hexapod.png"),
  kiton: require("@/assets/sprites/kiton.png"),
  phychi: require("@/assets/sprites/phychi.png"),
  mantis: require("@/assets/sprites/mantis.png"),
  moth: require("@/assets/sprites/moth.png"),
  raychi: require("@/assets/sprites/raychi.png"),
  boomchi: require("@/assets/sprites/boomchi.png"),
  exida: require("@/assets/sprites/exida.png"),
  doomux: require("@/assets/sprites/doomux.png"),
  livingIsland: require("@/assets/sprites/livingIsland.png"),
  centipede: require("@/assets/sprites/centipede.png"),
  segment: require("@/assets/sprites/segment.png"),
  insectEgg: require("@/assets/sprites/insectEgg.png"),
  larva: require("@/assets/sprites/larva.png"),
};

const SPECIAL_BUILDING_SPRITES: Record<string, ImageSourcePropType> = {
  sanctuary: require("@/assets/sprites/sanctuary.png"),
  outpost: require("@/assets/sprites/outpost.png"),
  iceBank: require("@/assets/sprites/iceBank.png"),
  fungi: require("@/assets/sprites/fungi.png"),
  mycelium: require("@/assets/sprites/mycelium.png"),
  clathrus: require("@/assets/sprites/clathrus.png"),
  iceTemple: require("@/assets/sprites/iceTemple.png"),
};

export function TribeEmblem({ clan, size }: { clan: string; size: number }) {
  const src = TRIBE_EMBLEMS[clan] ?? TRIBE_EMBLEMS.imperius;
  return <Image source={src} resizeMode="contain" style={{ width: size, height: size }} />;
}

export function SpecialUnitArt({ type, size }: { type: string; color: string; size: number }) {
  const src = SPECIAL_UNIT_SPRITES[type];
  if (!src) return null;
  return (
    <Image
      source={src}
      resizeMode="contain"
      style={{ position: "absolute", left: 0, top: 0, width: size, height: size }}
    />
  );
}

export function SpecialBuildingArt({ id, size }: { id: string; size: number }) {
  const src = SPECIAL_BUILDING_SPRITES[id];
  if (!src) return null;
  return (
    <Image
      source={src}
      resizeMode="contain"
      style={{ position: "absolute", left: 0, top: 0, width: size, height: size }}
    />
  );
}
