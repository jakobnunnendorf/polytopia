import React, { useEffect, useState } from "react";
import Tile from "./Tile";
import { spawnCapitals } from "@/logic/spawn";
import { useContext } from "react";
import { SettingsContext } from "@/context/SettingsContext";
import { View } from "react-native";

export default function Map() {
  const settings = useContext(SettingsContext);
  const [capitals, setCapitals] = useState<{ x: number; y: number }[]>([]);

  useEffect(() => {
    const newCapitals = spawnCapitals({
      players: settings.numberOfPlayers,
      mapSize: settings.mapSize,
    });
    setCapitals(newCapitals);
  }, [settings.numberOfPlayers, settings.mapSize]);

  return (
    <View
      testID="map-component"
      style={{
        gridTemplateColumns: `repeat(${settings.mapSize}, minmax(0, 1fr))`,
      }}
      className="grid gap-0 mx-auto max-w-fit"
    >
      {Array.from({ length: settings.mapSize ** 2 }).map((_, index) => {
        const x = index % settings.mapSize;
        const y = Math.floor(index / settings.mapSize);
        const isCapital = capitals.some((pos) => pos.x === x && pos.y === y);

        return (
          <Tile
            key={index}
            x={x}
            y={y}
            isCapital={isCapital}
            capitals={capitals}
          />
        );
      })}
    </View>
  );
}
