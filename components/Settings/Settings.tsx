import React, { useContext } from "react";
import { Pressable, Text, View } from "react-native";
import { SettingsContext } from "@/context/SettingsContext";
import { UI } from "@/components/game/theme";

const MAP_SIZES = [
  { title: "Tiny", size: 11 },
  { title: "Small", size: 14 },
  { title: "Normal", size: 16 },
  { title: "Large", size: 18 },
  { title: "Huge", size: 20 },
  { title: "Massive", size: 30 },
];

const MODES = [
  { id: "perfection", title: "Perfection", hint: "Highest score after 30 turns wins." },
  { id: "domination", title: "Domination", hint: "The last clan holding a city wins." },
] as const;

function Chip({ label, on, onPress, testID }: { label: string; on: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: 999,
        marginRight: 8,
        marginBottom: 8,
        backgroundColor: on ? UI.mist : "transparent",
        borderWidth: 1,
        borderColor: on ? UI.mist : UI.line,
      }}
    >
      <Text style={{ color: on ? UI.dusk : UI.mist, fontWeight: "700", fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <Text style={{ color: UI.muted, fontSize: 13, fontWeight: "700", marginTop: 16, marginBottom: 8 }}>{children}</Text>;
}

export default function Settings() {
  const settings = useContext(SettingsContext);
  const rivals = settings.numberOfPlayers - 1;
  const setRivals = (n: number) => settings.setNumberOfPlayers(Math.max(1, Math.min(15, n)) + 1);
  const mode = MODES.find((m) => m.id === settings.gameMode) ?? MODES[0];

  return (
    <View testID="settings-component">
      <Heading>Map size</Heading>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {MAP_SIZES.map((m) => (
          <Chip key={m.size} label={m.title} on={settings.mapSize === m.size} onPress={() => settings.setMapSize(m.size)} />
        ))}
      </View>

      <Heading>Rival clans</Heading>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Chip label="−" on={false} onPress={() => setRivals(rivals - 1)} testID="rivals-minus" />
        <Text style={{ color: UI.mist, fontSize: 22, fontWeight: "800", minWidth: 36, textAlign: "center", marginBottom: 8, marginRight: 8 }}>
          {rivals}
        </Text>
        <Chip label="+" on={false} onPress={() => setRivals(rivals + 1)} testID="rivals-plus" />
      </View>

      <Heading>Victory</Heading>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {MODES.map((m) => (
          <Chip key={m.id} label={m.title} on={mode.id === m.id} onPress={() => settings.setGameMode(m.id)} />
        ))}
      </View>
      <Text style={{ color: UI.muted, fontSize: 13 }}>{mode.hint}</Text>
    </View>
  );
}
