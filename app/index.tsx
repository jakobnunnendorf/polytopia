import { View, Image, Text } from "react-native";
import Map from "@/components/Map/Map";
import { useEffect, useState } from "react";
import * as Font from "expo-font";

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
    <View className="flex-1">
      {/* Background Image */}
      <Image
        source={require("@/assets/images/menu-background.webp")}
        className="absolute top-0 left-0 w-full h-full"
        resizeMode="cover"
      />

      {/* Map Container */}
      <View className="h-screen grid place-content-center">
        <View className="px-32 pb-16 bg-white/90 rounded-5xl">
          <Text className="text-2xl py-8 text-center font-oi">
            The Battle Of <br />
            <span className="text-4xl">Polytopia</span>
          </Text>
          <Map />
        </View>
      </View>
    </View>
  );
}
