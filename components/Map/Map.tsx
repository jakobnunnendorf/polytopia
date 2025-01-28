import React from "react";
import Tile from "./Tile";

export default function Map() {
  const size = 11;

  return (
    <div className="grid grid-cols-11">
      {Array.from({ length: size * size }).map((_, index) => (
        <Tile key={index} />
      ))}
    </div>
  );
}
