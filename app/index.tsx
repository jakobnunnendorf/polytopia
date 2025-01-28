import Map from "@/components/Map/Map";
import { View } from "react-native";

export default function HomeScreen() {
  return (
    <View className="h-screen grid place-content-center">
      <Map />
    </View>
  );
}
