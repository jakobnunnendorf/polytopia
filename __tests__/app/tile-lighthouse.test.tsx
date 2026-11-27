import React from "react";
import { render, screen } from "@testing-library/react-native";
import Tile from "@/components/Map/Tile";
import { seatLabel } from "@/components/game/GameList";
import type { ModelSpec } from "@/logic/agents/types";
import type { Tile as TileData } from "@/logic/engine/types";

const baseTile = (overrides: Partial<TileData> = {}): TileData => ({
  terrain: "field",
  resource: null,
  building: null,
  buildingLevel: 0,
  builtTurn: 0,
  road: false,
  cityId: null,
  village: false,
  ruin: false,
  lighthouse: true,
  territory: null,
  ice: false,
  algae: false,
  flooded: false,
  ...overrides,
});

const noBorders = { top: false, right: false, bottom: false, left: false };

describe("Tile corner lighthouse rendering", () => {
  it("renders a lighthouse with one tier per finder when explored", () => {
    render(
      <Tile
        x={0}
        y={0}
        tile={baseTile()}
        explored={true}
        city={null}
        territoryOwner={null}
        borders={noBorders}
        highlight={null}
        onPress={() => {}}
        lighthouseFinders={[0, 1]}
      />,
    );
    expect(screen.getByTestId("lighthouse-0-0")).toBeTruthy();
    expect(screen.getByTestId("lighthouse-0-0-tier-0")).toBeTruthy();
    expect(screen.getByTestId("lighthouse-0-0-tier-1")).toBeTruthy();
    expect(screen.queryByTestId("lighthouse-0-0-tier-2")).toBeNull();
  });

  it("renders a bare lighthouse when explored with no finders", () => {
    render(
      <Tile
        x={0}
        y={0}
        tile={baseTile()}
        explored={true}
        city={null}
        territoryOwner={null}
        borders={noBorders}
        highlight={null}
        onPress={() => {}}
        lighthouseFinders={[]}
      />,
    );
    expect(screen.getByTestId("lighthouse-0-0")).toBeTruthy();
    expect(screen.queryByTestId("lighthouse-0-0-tier-0")).toBeNull();
  });

  it("keeps the lighthouse hidden under clouds when unexplored", () => {
    render(
      <Tile
        x={0}
        y={0}
        tile={baseTile()}
        explored={false}
        city={null}
        territoryOwner={null}
        borders={noBorders}
        highlight={null}
        onPress={() => {}}
        lighthouseFinders={[0]}
      />,
    );
    expect(screen.queryByTestId("lighthouse-0-0")).toBeNull();
  });
});

describe("seatLabel short model names", () => {
  it("uses the short name from loaded models when available", () => {
    const models: ModelSpec[] = [
      { id: "greedy-full-probe-perf", name: "Probe P", kind: "greedy-full", description: "", created: "" },
      { id: "greedy-full-combo-perf", name: "Combo P", kind: "greedy-full", description: "", created: "" },
    ];
    expect(seatLabel({ kind: "model", modelId: "greedy-full-probe-perf" }, models)).toBe("Probe P");
    expect(seatLabel({ kind: "model", modelId: "greedy-full-combo-perf" }, models)).toBe("Combo P");
    expect(seatLabel({ kind: "model", modelId: "greedy-v1" }, models)).toBe("Greedy v1");
    expect(seatLabel({ kind: "human", profileId: "p1", name: "Jakob" }, models)).toBe("Jakob");
  });
});
