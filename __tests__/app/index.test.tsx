import { render, screen, waitFor } from "@testing-library/react-native";
import HomeScreen from "../../app/index";

jest.mock("expo-font", () => ({
  loadAsync: jest.fn(() => Promise.resolve()),
  isLoaded: jest.fn(() => true),
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

describe("Renders all elements", () => {
  it("should render the header", async () => {
    render(<HomeScreen />);
    await waitFor(() => {
      expect(screen.getByText(/Shardlands/)).toBeTruthy();
    });
  });
  it("should render the Settings Component", async () => {
    render(<HomeScreen />);
    await waitFor(() => {
      expect(screen.getByTestId("settings-component")).toBeTruthy();
    });
  });
  it("should render the start button", async () => {
    render(<HomeScreen />);
    await waitFor(() => {
      expect(screen.getByTestId("start-button")).toBeTruthy();
    });
  });
});
