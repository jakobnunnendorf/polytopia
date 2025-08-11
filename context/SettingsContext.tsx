import { createContext, useState } from "react";

type GameModeTypes = "perfection" | "domination";

type SettingsContextType = {
  mapSize: number;
  setMapSize: (size: number) => void;
  numberOfPlayers: number;
  setNumberOfPlayers: (players: number) => void;
  gameMode: GameModeTypes;
  setGameMode: (mode: GameModeTypes) => void;
};

export const SettingsContext = createContext<SettingsContextType>({
  mapSize: 11,
  setMapSize: () => {},
  numberOfPlayers: 2,
  setNumberOfPlayers: () => {},
  gameMode: "perfection",
  setGameMode: () => {},
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [size, setSize] = useState(11);
  const [numberOfPlayers, setNumberOfPlayers] = useState(2);
  const [gameMode, setGameMode] = useState<GameModeTypes>("perfection");
  return (
    <SettingsContext.Provider
      value={{
        mapSize: size,
        setMapSize: setSize,
        numberOfPlayers: numberOfPlayers,
        setNumberOfPlayers: setNumberOfPlayers,
        gameMode: gameMode,
        setGameMode: setGameMode,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}
