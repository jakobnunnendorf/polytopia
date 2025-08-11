import { View, ImageBackground, Text } from "react-native";
import Map from "@/components/Map/Map";
import Settings from "@/components/Settings/Settings";
import { useEffect, useState } from "react";
import * as Font from "expo-font";
import { SettingsProvider } from "@/context/SettingsContext";

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
    return null; // Or a loading indicator
  }

  return (
    <ImageBackground
      source={require("@/assets/images/menu-background.webp")}
      resizeMode="cover"
      className="w-full h-full gborder"
    >
      <SettingsProvider>
        <View className="flex items-center justify-center w-full h-full bborder">
          <View className="max-w-3xl px-32 mx-auto pb-28 rounded-3xl bg-white/90">
            <Text className="py-8 text-2xl text-center font-oi">
              The Battle Of <br />
              <span className="text-4xl">Polytopia</span>
            </Text>
            <Map />
            <Settings />
          </View>
        </View>
      </SettingsProvider>
    </ImageBackground>
  );
}
