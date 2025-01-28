import React, { useEffect, useState } from "react";
import Tile from "./Tile";
import { spawnCapitals } from "@/logic/spawn";

export default function Map() {
  const size = 11;
  const [capitals, setCapitals] = useState<{ x: number; y: number }[]>([]);

  useEffect(() => {
    // Generate capitals on mount with 4 players (default Polytopia setup)
    const newCapitals = spawnCapitals({ players: 4, mapSize: size });
    setCapitals(newCapitals);
  }, []);

  return (
    <div className="grid grid-cols-11">
      {Array.from({ length: size * size }).map((_, index) => {
        const x = index % size;
        const y = Math.floor(index / size);
        const isCapital = capitals.some((pos) => pos.x === x && pos.y === y);

        return <Tile key={index} isCapital={isCapital} />;
      })}
    </div>
  );
}
