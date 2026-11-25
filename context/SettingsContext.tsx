import { createContext, useState } from "react";
import type { Seat } from "@/logic/arena/record";
import { maxPlayersFor } from "@/logic/engine/data";
import { mapSizeAllowed, mapSizeFor, mapTypeFor } from "@/logic/engine/state";
import type { MapType } from "@/logic/engine/mapgen";
import type { Difficulty, GameMode } from "@/logic/engine/types";

type GameModeTypes = GameMode;

export const DEFAULT_SEATS: Seat[] = [
  { kind: "human", profileId: "guest", name: "Guest" },
  { kind: "model", modelId: "greedy-v1" },
];

type SettingsContextType = {
  /** the size the game will use: forced by Perfection and Domination, else the chosen one */
  mapSize: number;
  setMapSize: (size: number) => void;
  /** always seats.length; kept for older callers */
  numberOfPlayers: number;
  setNumberOfPlayers: (players: number) => void;
  gameMode: GameModeTypes;
  setGameMode: (mode: GameModeTypes) => void;
  /** bot difficulty */
  difficulty: Difficulty;
  setDifficulty: (d: Difficulty) => void;
  /** the world: how much land and water the map generator makes; forced by Perfection (Continents), else the chosen one */
  mapType: MapType;
  setMapType: (t: MapType) => void;
  /** who sits in each seat: a human profile or an opponent model */
  seats: Seat[];
  setSeats: (seats: Seat[]) => void;
};

export const SettingsContext = createContext<SettingsContextType>({
  mapSize: 11,
  setMapSize: () => {},
  numberOfPlayers: 2,
  setNumberOfPlayers: () => {},
  gameMode: "perfection",
  setGameMode: () => {},
  difficulty: "normal",
  setDifficulty: () => {},
  mapType: "drylands",
  setMapType: () => {},
  seats: DEFAULT_SEATS,
  setSeats: () => {},
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  // null = the size suggested for the mode and opponent count (mapSizeFor)
  const [size, setSize] = useState<number | null>(null);
  const [gameMode, setGameMode] = useState<GameModeTypes>("perfection");
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  // the chosen world; a mode that forces one (Perfection: Continents, see mapTypeFor) overrides it
  const [chosenType, setMapType] = useState<MapType>("drylands");
  const [seats, setSeats] = useState<Seat[]>(DEFAULT_SEATS);
  // any size the mode allows (Huge/Massive only in Creative and multiplayer) that holds every tribe;
  // without a choice, the suggested size for the mode and opponent count
  const fits = (n: number) => mapSizeAllowed(gameMode, n) && seats.length <= maxPlayersFor(n);
  const suggested = mapSizeFor(gameMode, seats.length - 1) ?? 16;
  const mapSize = size !== null && fits(size) ? size : suggested;
  const mapType = mapTypeFor(gameMode) ?? chosenType;
  const setNumberOfPlayers = (n: number) => {
    const target = Math.max(2, Math.min(16, n));
    setSeats((cur) =>
      cur.length >= target
        ? cur.slice(0, target)
        : [...cur, ...Array.from({ length: target - cur.length }, () => ({ kind: "model", modelId: "greedy-v1" }) as Seat)],
    );
  };
  return (
    <SettingsContext.Provider
      value={{
        mapSize,
        setMapSize: setSize,
        numberOfPlayers: seats.length,
        setNumberOfPlayers,
        gameMode,
        setGameMode,
        difficulty,
        setDifficulty,
        mapType,
        setMapType,
        seats,
        setSeats,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}
