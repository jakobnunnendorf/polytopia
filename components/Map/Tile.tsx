import React from "react";
import Capital from "./Capital";

export default function Tile({
  isCapital,
  x,
  y,
  capitals,
}: {
  isCapital?: boolean;
  x: number;
  y: number;
  capitals: { x: number; y: number }[];
}) {
  let isTerritory = false;
  let hasTopBorder = false;
  let hasRightBorder = false;
  let hasBottomBorder = false;
  let hasLeftBorder = false;

  for (const capital of capitals) {
    if (Math.abs(x - capital.x) <= 1 && Math.abs(y - capital.y) <= 1) {
      isTerritory = true;
      if (y === capital.y - 1) hasTopBorder = true;
      if (x === capital.x + 1) hasRightBorder = true;
      if (y === capital.y + 1) hasBottomBorder = true;
      if (x === capital.x - 1) hasLeftBorder = true;
      break; // No need to check other capitals once territory is confirmed
    }
  }

  return (
    <div
      className={`relative w-8 h-8 bg-green-500 border border-gray-300 
        ${hasTopBorder ? "border-t-2 border-0 border-dashed border-black" : ""} 
        ${hasRightBorder ? "border-r-2 border-0 border-dashed border-black" : ""} 
        ${hasBottomBorder ? "border-b-2 border-0 border-dashed border-black" : ""} 
        ${hasLeftBorder ? "border-l-2 border-0 border-dashed border-black" : ""}`}
    >
      {isCapital && <Capital />}
    </div>
  );
}
