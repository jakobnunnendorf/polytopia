import { View, ImageBackground, Text, Pressable, ScrollView } from "react-native";
import Settings from "@/components/Settings/Settings";
import { useContext, useEffect, useState } from "react";
import * as Font from "expo-font";
import { useRouter } from "expo-router";
import { SettingsContext } from "@/context/SettingsContext";
import { ShardIcon } from "@/components/art/Art";
import { UI } from "@/components/game/theme";

function StartButton() {
  const router = useRouter();
  const settings = useContext(SettingsContext);
  return (
    <Pressable
      testID="start-button"
      accessibilityRole="button"
      onPress={() =>
        router.push({
          pathname: "/game",
          params: {
            mapSize: String(settings.mapSize),
            players: String(settings.numberOfPlayers),
            mode: settings.gameMode,
            seed: String(Math.floor(Math.random() * 2 ** 31)),
          },
        })
      }
      style={({ pressed }) => ({
        marginTop: 24,
        paddingVertical: 15,
        borderRadius: 14,
        backgroundColor: UI.gold,
        opacity: pressed ? 0.85 : 1,
        alignItems: "center",
      })}
    >
      <Text style={{ color: UI.goldInk, fontSize: 17, fontWeight: "800" }}>Start a game</Text>
    </Pressable>
  );
}

export default function HomeScreen() {
  const [fontLoaded, setFontLoaded] = useState(false);

  useEffect(() => {
    async function loadFont() {
      await Font.loadAsync({
        "Oi-Regular": require("@/assets/fonts/Oi-Regular.ttf"),
      });
      setFontLoaded(true);
    }
    loadFont();
  }, []);

  if (!fontLoaded) {
    return null;
  }

  return (
    <ImageBackground
      source={require("@/assets/images/menu-background.webp")}
      resizeMode="cover"
      style={{ flex: 1, backgroundColor: UI.dusk }}
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end", alignItems: "center", padding: 16 }}>
        {/* the landscape stays visible above; logo and settings share one dusk panel */}
        <View
          style={{
            width: "100%",
            maxWidth: 440,
            backgroundColor: "#1b2846f2",
            borderRadius: 24,
            paddingHorizontal: 20,
            paddingTop: 22,
            paddingBottom: 20,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <ShardIcon size={40} />
            <Text style={{ fontFamily: UI.display, fontSize: 40, color: UI.mist, marginLeft: 10 }}>Shardlands</Text>
          </View>
          <Text style={{ color: UI.muted, fontSize: 15, marginTop: 6 }}>
            Build a clan from one city. Outgrow your rivals.
          </Text>
          <Settings />
          <StartButton />
        </View>
      </ScrollView>
    </ImageBackground>
  );
}
