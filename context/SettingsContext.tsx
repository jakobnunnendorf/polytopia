import { createContext, useState } from "react";
import type { Seat } from "@/logic/arena/record";

type GameModeTypes = "perfection" | "domination";

export const DEFAULT_SEATS: Seat[] = [
  { kind: "human", profileId: "guest", name: "Guest" },
  { kind: "model", modelId: "greedy-v1" },
];

type SettingsContextType = {
  mapSize: number;
  setMapSize: (size: number) => void;
  /** always seats.length; kept for older callers */
  numberOfPlayers: number;
  setNumberOfPlayers: (players: number) => void;
  gameMode: GameModeTypes;
  setGameMode: (mode: GameModeTypes) => void;
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
  seats: DEFAULT_SEATS,
  setSeats: () => {},
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [size, setSize] = useState(11);
  const [gameMode, setGameMode] = useState<GameModeTypes>("perfection");
  const [seats, setSeats] = useState<Seat[]>(DEFAULT_SEATS);
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
        mapSize: size,
        setMapSize: setSize,
        numberOfPlayers: seats.length,
        setNumberOfPlayers,
        gameMode,
        setGameMode,
        seats,
        setSeats,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}
