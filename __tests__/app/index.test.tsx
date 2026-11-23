import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import HomeScreen from "../../app/index";

jest.mock("expo-font", () => ({
  loadAsync: jest.fn(() => Promise.resolve()),
  isLoaded: jest.fn(() => true),
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

// no arena server in tests: every call fails soft
beforeAll(() => {
  global.fetch = jest.fn(() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
});

describe("Main menu", () => {
  it("shows the title and the three entries", async () => {
    render(<HomeScreen />);
    await waitFor(() => expect(screen.getByText(/Polytopia/)).toBeTruthy());
    expect(screen.getByTestId("new-game")).toBeTruthy();
    expect(screen.getByTestId("resume-game")).toBeTruthy();
    expect(screen.getByTestId("analyse-games")).toBeTruthy();
  });
  it("opens the game setup with seats and a start button", async () => {
    render(<HomeScreen />);
    await waitFor(() => expect(screen.getByTestId("new-game")).toBeTruthy());
    fireEvent.press(screen.getByTestId("new-game"));
    expect(screen.getByTestId("settings-component")).toBeTruthy();
    expect(screen.getByTestId("seat-0")).toBeTruthy();
    expect(screen.getByTestId("seat-1")).toBeTruthy();
    expect(screen.getByTestId("start-button")).toBeTruthy();
  });
});
