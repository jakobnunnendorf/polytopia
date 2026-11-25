import { View, ImageBackground, Text, Pressable, ScrollView } from "react-native";
import Settings from "@/components/Settings/Settings";
import GameList from "@/components/game/GameList";
import { useContext, useEffect, useState } from "react";
import * as Font from "expo-font";
import { useRouter } from "expo-router";
import { SettingsContext } from "@/context/SettingsContext";
import { StarIcon } from "@/components/art/Art";
import { UI } from "@/components/game/theme";
import { arena } from "@/components/game/arenaClient";
import { Pop, pressScale } from "@/components/anim";

type Page = "home" | "new" | "resume";

function StartButton() {
  const router = useRouter();
  const settings = useContext(SettingsContext);
  return (
    <Pressable
      testID="start-button"
      accessibilityRole="button"
      onPress={async () => {
        const seed = Math.floor(Math.random() * 2 ** 31);
        // models only: the server plays the game, the app watches it live
        if (settings.seats.every((s) => s.kind === "model")) {
          try {
            const { id } = await arena.startMatch({
              mapSize: settings.mapSize,
              mode: settings.gameMode,
              difficulty: settings.difficulty,
              mapType: settings.mapType,
              seed,
              seats: settings.seats,
            });
            router.push({ pathname: "/analyse", params: { id, live: "1" } } as never);
            return;
          } catch {
            // no server: play it in this tab instead
          }
        }
        router.push({
          pathname: "/game",
          params: {
            mapSize: String(settings.mapSize),
            players: String(settings.seats.length),
            seats: JSON.stringify(settings.seats),
            mode: settings.gameMode,
            difficulty: settings.difficulty,
            mapType: settings.mapType,
            seed: String(seed),
          },
        });
      }}
      style={({ pressed }) => ({
        marginTop: 20,
        paddingVertical: 15,
        borderRadius: 14,
        backgroundColor: UI.gold,
        opacity: pressed ? 0.85 : 1,
        alignItems: "center",
      })}
    >
      <Text style={{ color: UI.goldInk, fontSize: 17, fontWeight: "800" }}>Start the game</Text>
    </Pressable>
  );
}

function MenuButton({
  label,
  hint,
  onPress,
  primary,
  testID,
}: {
  label: string;
  hint: string;
  onPress: () => void;
  primary?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        marginTop: 10,
        paddingVertical: 14,
        paddingHorizontal: 18,
        borderRadius: 14,
        backgroundColor: primary ? UI.gold : UI.panelHi,
        opacity: pressed ? 0.85 : 1,
        transform: pressScale(pressed),
      })}
    >
      <Text style={{ color: primary ? UI.goldInk : UI.mist, fontSize: 17, fontWeight: "800" }}>{label}</Text>
      <Text style={{ color: primary ? UI.goldInk : UI.muted, fontSize: 13, marginTop: 2, opacity: primary ? 0.75 : 1 }}>{hint}</Text>
    </Pressable>
  );
}

function Back({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ paddingVertical: 6, marginTop: 10 }}>
      <Text style={{ color: UI.muted, fontSize: 15, fontWeight: "700" }}>‹ Back</Text>
    </Pressable>
  );
}

export default function HomeScreen() {
  const [fontLoaded, setFontLoaded] = useState(false);
  const [page, setPage] = useState<Page>("home");
  const router = useRouter();

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
        {/* the landscape stays visible above; logo and menu share one dusk panel */}
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
            <StarIcon size={40} />
            <Text style={{ fontFamily: UI.display, fontSize: 40, color: UI.mist, marginLeft: 10 }}>Polytopia</Text>
          </View>
          <Text style={{ color: UI.muted, fontSize: 15, marginTop: 6 }}>
            Build a tribe from one city. Outgrow your rivals.
          </Text>

          {page === "home" && (
            <View style={{ marginTop: 10 }}>
              <Pop force drop={-18} from={0.96}>
                <MenuButton primary testID="new-game" label="New game" hint="Choose the map, the players and their models" onPress={() => setPage("new")} />
              </Pop>
              <Pop force drop={-18} from={0.96} delay={90}>
                <MenuButton testID="resume-game" label="Resume game" hint="Continue a game you left" onPress={() => setPage("resume")} />
              </Pop>
              <Pop force drop={-18} from={0.96} delay={180}>
                <MenuButton testID="analyse-games" label="Analyse" hint="Rankings, replays of finished games, live games" onPress={() => router.push("/analyse" as never)} />
              </Pop>
            </View>
          )}
          {page === "new" && (
            <>
              <Back onPress={() => setPage("home")} />
              <Settings />
              <StartButton />
            </>
          )}
          {page === "resume" && (
            <>
              <Back onPress={() => setPage("home")} />
              <GameList finished={false} onPick={(g) => router.push({ pathname: "/game", params: { resume: g.id } })} />
            </>
          )}
        </View>
      </ScrollView>
    </ImageBackground>
  );
}
