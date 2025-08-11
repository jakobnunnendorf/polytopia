import React, { useContext } from "react";
import { View, Text } from "react-native";
import { SettingsContext } from "@/context/SettingsContext";
import { Picker } from "@react-native-picker/picker";

const MapSize = ({ title }: { title: string }) => (
  <View className="px-4 py-2 mx-2 capitalize bg-yellow-300 border border-yellow-600 rounded-lg last:mr-0 first:ml-0 w-fit">
    <Text>{title}</Text>
  </View>
);

export default function Settings() {
  const settings = useContext(SettingsContext);
  const mapSizes = [
    { title: "tiny", size: 11 },
    { title: "small", size: 14 },
    { title: "normal", size: 16 },
    { title: "large", size: 18 },
    { title: "huge", size: 20 },
    { title: "massive", size: 30 },
  ];
  const gameModes = ["perfection", "domination"];
  return (
    <View className="mt-4 " testID='settings-component'>
      <Text>Select Map Size:</Text>
      <Picker
        selectedValue={settings.mapSize}
        onValueChange={(itemValue) => settings.setMapSize(itemValue)}
        style={{ height: 50, width: 200 }}
        className="capitalize"
      >
        {mapSizes.map((size) => (
          <Picker.Item
            key={size.size}
            label={`${size.title} (${size.size}x${size.size})`}
            value={size.size}
          />
        ))}
      </Picker>
      <Text>Number of Opponents</Text>
      <Picker
        selectedValue={settings.numberOfPlayers - 1}
        onValueChange={(itemValue) => {
          console.log(typeof itemValue, itemValue);
          const players = Number(itemValue) + 1;
          console.log(typeof players, players);
          settings.setNumberOfPlayers(Number(players));
        }}
        style={{ height: 50, width: 200 }}
      >
        {Array.from({ length: 15 }, (_, i) => i + 1).map((nOpponents) => (
          <Picker.Item
            key={nOpponents}
            label={nOpponents.toString()}
            value={nOpponents.toString()}
          />
        ))}
      </Picker>
      <Text>Select Game Mode:</Text>
      <Picker
        selectedValue={settings.gameMode}
        onValueChange={(itemValue) => settings.setGameMode(itemValue)}
        style={{ height: 50, width: 200 }}
        className="capitalize"
      >
        {gameModes.map((gameMode) => (
          <Picker.Item key={gameMode} label={gameMode} value={gameMode} />
        ))}
      </Picker>
    </View>
  );
}
