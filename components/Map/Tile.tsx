import React from "react";
import Capital from "./Capital";

export default function Tile({ isCapital }: { isCapital?: boolean }) {
  return (
    <div className="relative w-8 h-8 bg-green-500 border border-gray-300">
      {isCapital && <Capital />}
    </div>
  );
}
