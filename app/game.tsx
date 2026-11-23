import { Text, View } from "react-native";

// Placeholder until the engine lands; then this re-exports components/game/GameScreen.
export default function GameScreen() {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#1f2633",
      }}
    >
      <Text style={{ color: "white", fontSize: 18 }}>
        Shardlands engine under construction…
      </Text>
    </View>
  );
}
