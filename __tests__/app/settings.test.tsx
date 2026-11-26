import { fireEvent, render, screen } from "@testing-library/react-native";
import fs from "fs";
import path from "path";
import Settings, { pickerModels } from "../../components/Settings/Settings";
import { modelFacts, modelTagline } from "../../components/Settings/ModelCard";
import { compass, sampleWorld, seatGrid, windowFor } from "../../components/Settings/WorldBoard";
import { SettingsProvider } from "../../context/SettingsContext";
import type { ModelSpec } from "../../logic/agents/types";
import type { Ratings } from "../../logic/arena/elo";

// no arena server in tests: every call fails soft
beforeAll(() => {
  global.fetch = jest.fn(() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
});

const bonus = () => screen.queryByTestId("perfection-bonus");

describe("Game setup: Perfection difficulty bonus", () => {
  it("shows the bonus for the chosen difficulty and opponents, updating live", () => {
    render(
      <SettingsProvider>
        <Settings />
      </SettingsProvider>,
    );
    // Perfection is the default mode; two seats = one opponent, Normal = 100 + 20 + 0
    expect(bonus()!.props.children).toBe("Difficulty bonus: 120%");
    fireEvent.press(screen.getByTestId("difficulty-crazy"));
    expect(bonus()!.props.children).toBe("Difficulty bonus: 180%");
    fireEvent.press(screen.getByTestId("add-seat"));
    fireEvent.press(screen.getByTestId("add-seat"));
    // three opponents on Crazy
    expect(bonus()!.props.children).toBe("Difficulty bonus: 210%");
    fireEvent.press(screen.getByTestId("difficulty-easy"));
    expect(bonus()!.props.children).toBe("Difficulty bonus: 130%");
  });

  it("is hidden in other modes", () => {
    render(
      <SettingsProvider>
        <Settings />
      </SettingsProvider>,
    );
    expect(bonus()).toBeTruthy();
    fireEvent.press(screen.getByTestId("mode-domination"));
    expect(bonus()).toBeNull();
    fireEvent.press(screen.getByTestId("mode-perfection"));
    expect(bonus()).toBeTruthy();
  });
});

describe("Game setup: model picker", () => {
  const spec = (id: string, extra: Partial<ModelSpec> = {}): ModelSpec =>
    ({ id, name: id, kind: "greedy-full", description: "", created: "2026-11-25", ...extra }) as ModelSpec;

  it("leaves out hidden models and puts the strongest first", () => {
    const models = [spec("old", { hidden: true }), spec("weak"), spec("champ"), spec("unrated")];
    const overall = { "model:weak": { rating: 1200 }, "model:champ": { rating: 1900 }, "model:old": { rating: 2000 } } as unknown as Ratings;
    expect(pickerModels(models, overall).map((m) => m.id)).toEqual(["champ", "weak", "unrated"]);
  });

  it("shows model cards with rank, one-liner and facts, and a tap picks the model", () => {
    render(
      <SettingsProvider>
        <Settings />
      </SettingsProvider>,
    );
    // the board shows every seat on its starting region; tapping one opens it in the editor below
    fireEvent.press(screen.getByTestId("seat-1"));
    expect(screen.getByTestId("seat-1").props.accessibilityState).toEqual({ selected: true });
    // offline: the built-in models
    expect(screen.getAllByText("Random legal moves. The floor every model must beat.").length).toBeGreaterThan(0);
    fireEvent.press(screen.getAllByTestId("model-card-random-v1")[0]);
    expect(screen.getAllByTestId("model-card-random-v1")[0].props.accessibilityState).toEqual({ selected: true });
  });

  it("card facts: family, parent by name, training games and time, date", () => {
    const parent = spec("greedy-full-combo", { name: "Combo" });
    const probe = spec("greedy-full-probe", {
      name: "Probe",
      created: "2026-11-25",
      training: { from: "greedy-full-combo", trainingGames: 100020, duration: "48m24s" },
    });
    expect(modelFacts(probe, [parent, probe])).toBe("Full greedy, built on Combo\n100k games in 48m24s, 25 Nov");
    expect(modelTagline(spec("x", { description: "First sentence. Second one." }))).toBe("First sentence.");
  });

  it("the sample world seats every player on a region of its own, and deals a new one on request", () => {
    for (const players of [2, 4, 9, 16]) {
      const w = sampleWorld({ mapSize: players > 9 ? 18 : 16, players, mode: "domination", mapType: "continents", seed: 7 })!;
      expect(w.side).toBe(Math.ceil(Math.sqrt(players)));
      expect(new Set(w.regionOf).size).toBe(players);
      expect(w.terrain.length).toBe(w.n * w.n);
    }
    const a = sampleWorld({ mapSize: 16, players: 4, mode: "perfection", mapType: "continents", seed: 1 })!;
    const b = sampleWorld({ mapSize: 16, players: 4, mode: "perfection", mapType: "continents", seed: 2 })!;
    expect(a.terrain.join()).not.toBe(b.terrain.join());
    expect(compass({ x: 2, y: 3 }, 16)).toBe("the north-west");
    expect(compass({ x: 8, y: 7 }, 16)).toBe("the centre");
    expect(compass({ x: 13, y: 8 }, 16)).toBe("the east");
    // two capitals in the south-east quarter still get a square each, and keep their relation
    expect(seatGrid([{ x: 2, y: 8 }, { x: 13, y: 2 }, { x: 10, y: 13 }, { x: 11, y: 9 }], 16, 2)).toEqual([0, 1, 2, 3]);
    // the card's window keeps the capital inside it, also at the map's edge
    expect(windowFor({ x: 15, y: 15 }, 16, 8)).toEqual({ x0: 8, y0: 8 });
  });

  it("every model folder has a spec or is an experiment's measurement record, and the gate's champions stay in the picker", () => {
    const dir = path.join(__dirname, "../../models");
    // measurement records (experiments/README.md): a sweep or tuning run without model.json, kept
    // because an experiment lists it under `runs`; the app, arena and tournament skip them
    const expDir = path.join(__dirname, "../../experiments");
    const cited = new Set<string>(
      fs
        .readdirSync(expDir)
        .filter((d) => fs.existsSync(path.join(expDir, d, "experiment.json")))
        .flatMap((d) => JSON.parse(fs.readFileSync(path.join(expDir, d, "experiment.json"), "utf8")).runs ?? [])
        .map((r: { id: string }) => r.id),
    );
    const specs: ModelSpec[] = fs
      .readdirSync(dir)
      .filter((d) => fs.statSync(path.join(dir, d)).isDirectory())
      .filter((id) => {
        if (fs.existsSync(path.join(dir, id, "model.json"))) return true;
        const isRecord = ["sweep.jsonl", "record.json"].some((f) => fs.existsSync(path.join(dir, id, f)));
        expect({ id, record: isRecord && cited.has(id) }).toEqual({ id, record: true });
        return false;
      })
      .map((id) => JSON.parse(fs.readFileSync(path.join(dir, id, "model.json"), "utf8")));
    const listed = new Set(specs.filter((s) => !s.hidden).map((s) => s.id));
    for (const id of ["greedy-full-probe", "greedy-full-combo", "greedy-full-economy"]) expect(listed.has(id)).toBe(true);
  });
});
