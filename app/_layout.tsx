import { useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import { Slot } from "expo-router";
import { SettingsProvider } from "@/context/SettingsContext";
import { initRustEngine } from "@/logic/engine/rust";
import "./global.css";

// The rules engine is Rust compiled to WebAssembly (public/polyengine.wasm,
// built by `npm run engine:build`). It loads once here, before any screen
// calls the engine; after that every engine call is synchronous.
let engineReady: Promise<void> | null = null;
const loadEngine = () => (engineReady ??= initRustEngine("/polyengine.wasm"));

export default function HomeLayout() {
  const [state, setState] = useState<"loading" | "ready" | string>(Platform.OS === "web" ? "loading" : "native");

  useEffect(() => {
    if (Platform.OS !== "web") return;
    loadEngine().then(
      () => setState("ready"),
      (e: unknown) => setState(`The game engine could not be loaded: ${(e as Error)?.message ?? e}`),
    );
  }, []);

  if (state !== "ready") {
    const text =
      state === "loading"
        ? "Loading the game engine…"
        : state === "native"
          ? "The game engine is WebAssembly and runs in the web build only (npm run web)."
          : state;
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text>{text}</Text>
      </View>
    );
  }
  return (
    <SettingsProvider>
      <Slot />
    </SettingsProvider>
  );
}
