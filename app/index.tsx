import { View, Image } from "react-native";
import Map from "@/components/Map/Map";

export default function HomeScreen() {
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
        <div className="px-32 pb-16 bg-white/90 rounded-3xl font-family-[Oi-Regular]">
          <h1 className="text-3xl font-bold py-8 text-center">Polytopia</h1>
          <Map />
        </div>
      </View>
    </View>
  );
}
