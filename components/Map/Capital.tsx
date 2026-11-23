import React from "react";
import { View, Text } from "react-native";

/** City marker: a banner-coloured keep with the city level; capitals get a crown. */
export default function Capital({
  color,
  level,
  capital,
  walls,
}: {
  color: string;
  level: number;
  capital: boolean;
  walls: boolean;
}) {
  return (
    <View
      style={{
        position: "absolute",
        left: 6,
        top: 6,
        right: 6,
        bottom: 6,
        borderRadius: 8,
        backgroundColor: color,
        borderWidth: walls ? 3 : 2,
        borderColor: walls ? "#3b3b3b" : "#ffffffcc",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: "800", color: "white" }}>
        {capital ? "♛" : ""}
        {level}
      </Text>
    </View>
  );
}
