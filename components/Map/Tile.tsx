import React from "react";
import Capital from "./Capital";

export default function Tile({
  isCapital,
  isTerritory,
}: {
  isCapital?: boolean;
  isTerritory?: boolean;
}) {
  return (
    <div
      className={`relative w-8 h-8 bg-green-500 border ${
        isTerritory ? "border-dashed border-yellow-600" : "border-gray-300"
      }`}
    >
      {isCapital && <Capital />}
    </div>
  );
}
