import { fireEvent, render, screen } from "@testing-library/react-native";
import fs from "fs";
import path from "path";
import Settings, { pickerModels } from "../../components/Settings/Settings";
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

  it("leaves out hidden and external models and puts the strongest first", () => {
    const models = [spec("old", { hidden: true }), spec("weak"), spec("champ"), spec("cli", { kind: "external" }), spec("unrated")];
    const overall = { "model:weak": { rating: 1200 }, "model:champ": { rating: 1900 }, "model:old": { rating: 2000 } } as unknown as Ratings;
    expect(pickerModels(models, overall).map((m) => m.id)).toEqual(["champ", "weak", "unrated"]);
  });

  it("every model folder has a spec, and the gate's champions stay in the picker", () => {
    const dir = path.join(__dirname, "../../models");
    const specs: ModelSpec[] = fs
      .readdirSync(dir)
      .filter((d) => fs.statSync(path.join(dir, d)).isDirectory())
      .map((id) => {
        const file = path.join(dir, id, "model.json");
        expect(fs.existsSync(file)).toBe(true);
        return JSON.parse(fs.readFileSync(file, "utf8"));
      });
    const listed = new Set(specs.filter((s) => !s.hidden).map((s) => s.id));
    for (const id of ["greedy-full-probe", "greedy-full-combo", "greedy-full-economy"]) expect(listed.has(id)).toBe(true);
  });
});
