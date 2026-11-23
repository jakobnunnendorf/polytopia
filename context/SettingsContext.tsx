import { createContext, useState } from "react";
import type { Seat } from "@/logic/arena/record";
import { maxPlayersFor } from "@/logic/engine/data";
import { mapSizeAllowed, mapSizeFor } from "@/logic/engine/state";
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
  seats: DEFAULT_SEATS,
  setSeats: () => {},
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [size, setSize] = useState(11);
  const [gameMode, setGameMode] = useState<GameModeTypes>("perfection");
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [seats, setSeats] = useState<Seat[]>(DEFAULT_SEATS);
  // Perfection and Domination force the size; Huge/Massive only where the mode allows them
  const forced = mapSizeFor(gameMode, seats.length - 1);
  const mapSize = forced ?? (mapSizeAllowed(gameMode, size) && seats.length <= maxPlayersFor(size) ? size : 16);
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
        seats,
        setSeats,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}
