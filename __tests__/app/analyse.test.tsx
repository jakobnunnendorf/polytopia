import { render, screen, waitFor } from "@testing-library/react-native";
import AnalyseScreen from "../../app/analyse";
import { arena } from "../../components/game/arenaClient";
import { applyAction } from "../../logic/engine/actions";
import { botStep } from "../../logic/engine/bot";
import { createGame } from "../../logic/engine/state";
import { liveWindow, recordStep, replayStates, startRecord, type GameRecord } from "../../logic/arena/record";

jest.mock("expo-font", () => ({
  loadAsync: jest.fn(() => Promise.resolve()),
  isLoaded: jest.fn(() => true),
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({ id: "g1", live: "1" }),
}));

jest.mock("../../components/game/arenaClient", () => ({
  arena: {
    game: jest.fn(),
    liveGame: jest.fn(),
    gameSteps: jest.fn(),
    resumeMatch: jest.fn(() => Promise.resolve({ ok: true })),
    getPace: jest.fn(() => Promise.resolve({ ms: 1000 })),
    setPace: jest.fn(() => Promise.resolve({ ok: true, ms: 1000 })),
    stopMatch: jest.fn(() => Promise.resolve({ ok: true })),
  },
}));

/** a running game: `early` is what the server has when the page opens, `full` a little later */
function runningGame(): { early: GameRecord; full: GameRecord } {
  let s = createGame({ mapSize: 11, players: 2, mode: "perfection", seed: 7, humans: [] });
  const full = startRecord(s, [
    { kind: "model", modelId: "greedy-v1" },
    { kind: "model", modelId: "random-v1" },
  ], "arena");
  full.id = "g1";
  let guard = 0;
  while (!s.over && s.turn <= 6 && guard++ < 3000) {
    const a = botStep(s);
    const next = applyAction(s, a);
    recordStep(full, s, a, next);
    s = next;
  }
  // the server's copy three moves into an earlier player-turn
  const states = replayStates(full);
  const ends = full.steps.flatMap((st, i) => (st.a.type === "endTurn" ? [i + 1] : []));
  const at = ends[ends.length - 4];
  const early: GameRecord = { ...full, steps: full.steps.slice(0, at + 3), checkpoint: { step: at, state: states[at] } };
  return { early, full };
}

describe("Analyse, live view", () => {
  it("opens at the checkpoint and then asks only for the moves it lacks", async () => {
    const { early, full } = runningGame();
    const have = early.steps.length;
    expect(early.checkpoint!.step).toBeGreaterThan(20);
    (arena.liveGame as jest.Mock).mockResolvedValue(liveWindow(early));
    (arena.gameSteps as jest.Mock).mockImplementation((_id: string, from: number) =>
      Promise.resolve({ total: full.steps.length, steps: full.steps.slice(from), endedAt: null, result: null, stoppedAt: null }),
    );

    render(<AnalyseScreen />);
    // move numbers count from the start of the game, although only three moves were replayed
    await waitFor(() => expect(screen.getByText(new RegExp(`move ${have} of ${have}$`))).toBeTruthy());
    expect(arena.liveGame).toHaveBeenCalledTimes(1);
    expect(arena.game).not.toHaveBeenCalled();

    // the poll asks for what comes after the moves it has, and the new moves join the replay
    await waitFor(() => expect(screen.getByText(new RegExp(` of ${full.steps.length}$`))).toBeTruthy(), { timeout: 4000 });
    expect((arena.gameSteps as jest.Mock).mock.calls[0]).toEqual(["g1", have]);
    await waitFor(() => expect(arena.gameSteps).toHaveBeenCalledWith("g1", full.steps.length), { timeout: 4000 });
    expect(arena.liveGame).toHaveBeenCalledTimes(1);
    // own timeout: a game is simulated first and the two waits above allow 4 s each for the
    // screen's poll, more than Jest's 5 s default; slower CI runners crossed it
  }, 20000);
});
