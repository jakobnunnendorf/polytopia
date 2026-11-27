import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import GameScreen from "../../components/game/GameScreen";

jest.mock("expo-font", () => ({
  loadAsync: jest.fn(() => Promise.resolve()),
  isLoaded: jest.fn(() => true),
}));

// the seats of the game under test; set before each render
let mockSeats = "[]";
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({ mapSize: "11", players: "2", seats: mockSeats, mode: "perfection", seed: "7" }),
}));

// no arena server, as on the hosted web app: every call fails
jest.mock("../../components/game/arenaClient", () => {
  const fail = () => Promise.reject(new Error("offline"));
  return {
    arena: new Proxy({}, { get: () => jest.fn(fail) }),
  };
});

describe("A game played in this tab", () => {
  it("shows the watch panels and the speed control when every seat is a model", async () => {
    mockSeats = JSON.stringify([
      { kind: "model", modelId: "greedy-v1" },
      { kind: "model", modelId: "random-v1" },
    ]);
    render(<GameScreen />);
    // a narrow screen (the test window): the panels open from toggle buttons, as in /analyse
    fireEvent.press(screen.getByText("Events"));
    expect(screen.getByText("What just happened")).toBeTruthy();
    fireEvent.press(screen.getByText("Leaderboard"));
    expect(screen.getByText("Now playing")).toBeTruthy();
    expect(screen.getByLabelText("rank by score")).toBeTruthy();
    expect(screen.getByTestId("pause-game")).toBeTruthy();
    // the player screen's controls are not there
    expect(screen.queryByTestId("end-turn")).toBeNull();

    // the speed control sets the pace and pausing stops the game
    fireEvent.press(screen.getByLabelText("speed 4×"));
    expect(screen.getByLabelText("speed 4×").props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByText(/250 ms per move/)).toBeTruthy();
    // the models play: the move counter advances
    await waitFor(() => expect(screen.getByText(/move [1-9]\d* of/)).toBeTruthy(), { timeout: 4000 });
    fireEvent.press(screen.getByTestId("pause-game"));
    await waitFor(() => expect(screen.getByText(/^PAUSED/)).toBeTruthy());
    const moves = () => screen.getByText(/ of \d+$/).props.children.join("");
    // let a move already under way land, then nothing more happens while paused
    await act(() => new Promise((r) => setTimeout(r, 700)));
    const at = moves();
    await act(() => new Promise((r) => setTimeout(r, 800)));
    expect(moves()).toBe(at);
  }, 20000);

  it("keeps the player screen when a seat is human", () => {
    mockSeats = JSON.stringify([
      { kind: "human", profileId: "guest", name: "Guest" },
      { kind: "model", modelId: "greedy-v1" },
    ]);
    render(<GameScreen />);
    expect(screen.getByTestId("end-turn")).toBeTruthy();
    expect(screen.queryByText("Now playing")).toBeNull();
    expect(screen.queryByText("Leaderboard")).toBeNull();
    expect(screen.queryByText("Events")).toBeNull();
    expect(screen.queryByText("What just happened")).toBeNull();
    expect(screen.queryByLabelText("speed 4×")).toBeNull();
  });
});
