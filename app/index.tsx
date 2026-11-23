import { View, ImageBackground, Text, Pressable } from "react-native";
import Settings from "@/components/Settings/Settings";
import { useContext, useEffect, useState } from "react";
import * as Font from "expo-font";
import { useRouter } from "expo-router";
import { SettingsContext } from "@/context/SettingsContext";

function StartButton() {
  const router = useRouter();
  const settings = useContext(SettingsContext);
  return (
    <Pressable
      testID="start-button"
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
      className="px-6 py-3 mt-6 bg-amber-500 border-2 border-amber-700 rounded-xl"
    >
      <Text className="text-lg font-bold text-center text-white">
        Start game
      </Text>
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
      className="w-full h-full"
    >
      <View className="flex items-center justify-center w-full h-full px-4">
        <View className="w-full max-w-md px-6 py-8 rounded-3xl bg-white/90">
          <Text className="text-2xl text-center font-oi">
            {"The Age Of\n"}
            <Text className="text-4xl">Shardlands</Text>
          </Text>
          <Settings />
          <StartButton />
        </View>
      </View>
    </ImageBackground>
  );
}
