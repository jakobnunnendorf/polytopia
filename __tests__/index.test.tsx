import { render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import HomeScreen from "../app/index";

jest.mock("expo-font", () => ({
  loadAsync: jest.fn(() => Promise.resolve()),
  isLoaded: jest.fn(() => true),
}));

describe("Renders all elements", () => {
  it("should render the header", async () => {
    render(<HomeScreen />);
    await waitFor(() => {
      const header = screen.getByText("The Battle Of Polytopia");
      expect(header).toBeTruthy();
    });
  });
  it("should render the Map Component", async () => {
    render(<HomeScreen />);
    await waitFor(() => {
      const mapComponent = screen.getByTestId("map-component");
      expect(mapComponent).toBeTruthy();
    });
  });
  it("should render the Settings Component", async () => {
    render(<HomeScreen />);
    await waitFor(() => {
      const settingsComponent = screen.getByTestId("settings-component");
      expect(settingsComponent).toBeTruthy();
    });
  });
});
