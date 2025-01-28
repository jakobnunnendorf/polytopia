import { View, Text } from "react-native";

export default function HomeScreen() {
  return (
    <View className="h-screen bg-[#37bef8] grid place-content-center">
      <Text className="text-white font-bold text-3xl">
        Tailwind CSS succesfully installed!
      </Text>
    </View>
  );
}
