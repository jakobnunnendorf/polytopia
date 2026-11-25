import { fireEvent, render, screen } from "@testing-library/react-native";
import Settings from "../../components/Settings/Settings";
import { SettingsProvider } from "../../context/SettingsContext";

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
