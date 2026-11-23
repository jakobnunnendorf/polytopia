import { Slot } from "expo-router";
import { SettingsProvider } from "@/context/SettingsContext";
import "./global.css";

export default function HomeLayout() {
  return (
    <SettingsProvider>
      <Slot />
    </SettingsProvider>
  );
}
