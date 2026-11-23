import React, { useContext, useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { SettingsContext } from "@/context/SettingsContext";
import { PLAYER_COLORS, UI } from "@/components/game/theme";
import { arena, type Profile } from "@/components/game/arenaClient";
import { BUILTIN_MODELS } from "@/logic/agents/registry";
import type { ModelSpec } from "@/logic/agents/types";
import type { Ratings } from "@/logic/arena/elo";
import type { Seat } from "@/logic/arena/record";

const MAP_SIZES = [
  { title: "Tiny", size: 11 },
  { title: "Small", size: 14 },
  { title: "Normal", size: 16 },
  { title: "Large", size: 18 },
  { title: "Huge", size: 20 },
  { title: "Massive", size: 30 },
];

const MODES = [
  { id: "perfection", title: "Perfection", hint: "Highest score after 30 turns wins." },
  { id: "domination", title: "Domination", hint: "The last clan holding a city wins." },
] as const;

const GUEST: Profile = { id: "guest", name: "Guest", created: "" };

function Chip({
  label,
  on,
  onPress,
  testID,
  sub,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  testID?: string;
  sub?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 999,
        marginRight: 8,
        marginBottom: 8,
        backgroundColor: on ? UI.mist : "transparent",
        borderWidth: 1,
        borderColor: on ? UI.mist : UI.line,
        flexDirection: "row",
        alignItems: "baseline",
      }}
    >
      <Text style={{ color: on ? UI.dusk : UI.mist, fontWeight: "700", fontSize: 14 }}>{label}</Text>
      {sub ? <Text style={{ color: on ? UI.panelHi : UI.muted, fontSize: 12, marginLeft: 6 }}>{sub}</Text> : null}
    </Pressable>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <Text style={{ color: UI.muted, fontSize: 13, fontWeight: "700", marginTop: 16, marginBottom: 8 }}>{children}</Text>;
}

/** one seat: a human profile (for Elo per local player) or an opponent model */
function SeatRow({
  i,
  seat,
  profiles,
  models,
  ratings,
  onChange,
  onRemove,
  onNewProfile,
}: {
  i: number;
  seat: Seat;
  profiles: Profile[];
  models: ModelSpec[];
  ratings: Ratings;
  onChange: (s: Seat) => void;
  onRemove?: () => void;
  onNewProfile: (name: string) => Promise<Profile | null>;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const elo = (key: string) => (ratings[key] ? String(Math.round(ratings[key].rating)) : undefined);
  return (
    <View style={{ paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: UI.line }} testID={`seat-${i}`}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: PLAYER_COLORS[i % PLAYER_COLORS.length], marginRight: 8 }} />
        <Text style={{ color: UI.mist, fontWeight: "800", fontSize: 15, flex: 1 }}>
          {i === 0 ? "First to move" : `Seat ${i + 1}`}
        </Text>
        <Chip label="Person" on={seat.kind === "human"} onPress={() => onChange({ kind: "human", profileId: GUEST.id, name: GUEST.name })} />
        <Chip label="Model" on={seat.kind === "model"} onPress={() => onChange({ kind: "model", modelId: models[0]?.id ?? "greedy-v1" })} />
        {onRemove && (
          <Pressable onPress={onRemove} accessibilityRole="button" accessibilityLabel={`Remove seat ${i + 1}`} style={{ padding: 6, marginBottom: 8 }}>
            <Text style={{ color: UI.muted, fontSize: 18 }}>×</Text>
          </Pressable>
        )}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {seat.kind === "model"
          ? models.map((m) => (
              <Chip
                key={m.id}
                label={m.name}
                sub={elo(`model:${m.id}`)}
                on={seat.modelId === m.id}
                onPress={() => onChange({ kind: "model", modelId: m.id })}
              />
            ))
          : [GUEST, ...profiles].map((p) => (
              <Chip
                key={p.id}
                label={p.name}
                sub={elo(`human:${p.id}`)}
                on={seat.profileId === p.id}
                onPress={() => onChange({ kind: "human", profileId: p.id, name: p.name })}
              />
            ))}
        {seat.kind === "human" && !adding && <Chip label="+ New player" on={false} onPress={() => setAdding(true)} />}
      </View>
      {seat.kind === "human" && adding && (
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <TextInput
            autoFocus
            value={draft}
            onChangeText={setDraft}
            placeholder="Name"
            placeholderTextColor={UI.muted}
            style={{
              flex: 1,
              color: UI.mist,
              borderWidth: 1,
              borderColor: UI.line,
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 8,
              marginRight: 8,
              fontSize: 15,
            }}
            onSubmitEditing={async () => {
              const p = await onNewProfile(draft);
              if (p) onChange({ kind: "human", profileId: p.id, name: p.name });
              setAdding(false);
              setDraft("");
            }}
          />
          <Chip
            label="Save"
            on
            onPress={async () => {
              const p = await onNewProfile(draft);
              if (p) onChange({ kind: "human", profileId: p.id, name: p.name });
              setAdding(false);
              setDraft("");
            }}
          />
        </View>
      )}
      {seat.kind === "model" && (
        <Text style={{ color: UI.muted, fontSize: 12, lineHeight: 17 }} numberOfLines={2}>
          {models.find((m) => m.id === seat.modelId)?.description}
        </Text>
      )}
    </View>
  );
}

export default function Settings() {
  const settings = useContext(SettingsContext);
  const mode = MODES.find((m) => m.id === settings.gameMode) ?? MODES[0];
  const [models, setModels] = useState<ModelSpec[]>(BUILTIN_MODELS);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [ratings, setRatings] = useState<Ratings>({});
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([arena.models(), arena.profiles(), arena.ratings()])
      .then(([m, p, r]) => {
        if (!live) return;
        if (m.length) setModels(m.filter((x) => x.kind !== "external"));
        setProfiles(p);
        setRatings(r);
        setOnline(true);
      })
      .catch(() => live && setOnline(false));
    return () => {
      live = false;
    };
  }, []);

  const seats = settings.seats;
  const setSeat = (i: number, s: Seat) => settings.setSeats(seats.map((x, j) => (j === i ? s : x)));
  const newProfile = async (name: string) => {
    if (!name.trim()) return null;
    try {
      const p = await arena.createProfile(name);
      setProfiles((cur) => (cur.some((x) => x.id === p.id) ? cur : [...cur, p]));
      return p;
    } catch {
      return null;
    }
  };

  return (
    <View testID="settings-component">
      <Heading>Map size</Heading>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {MAP_SIZES.map((m) => (
          <Chip key={m.size} label={m.title} on={settings.mapSize === m.size} onPress={() => settings.setMapSize(m.size)} />
        ))}
      </View>

      <Heading>Victory</Heading>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {MODES.map((m) => (
          <Chip key={m.id} label={m.title} on={mode.id === m.id} onPress={() => settings.setGameMode(m.id)} />
        ))}
      </View>
      <Text style={{ color: UI.muted, fontSize: 13 }}>{mode.hint}</Text>

      <Heading>Players</Heading>
      {seats.map((seat, i) => (
        <SeatRow
          key={i}
          i={i}
          seat={seat}
          profiles={profiles}
          models={models}
          ratings={ratings}
          onChange={(s) => setSeat(i, s)}
          onRemove={seats.length > 2 ? () => settings.setSeats(seats.filter((_, j) => j !== i)) : undefined}
          onNewProfile={newProfile}
        />
      ))}
      {seats.length < 16 && (
        <Chip
          testID="add-seat"
          label="+ Add a seat"
          on={false}
          onPress={() => settings.setSeats([...seats, { kind: "model", modelId: models[0]?.id ?? "greedy-v1" }])}
        />
      )}
      {online === false && (
        <Text style={{ color: UI.coral, fontSize: 13, lineHeight: 18, marginTop: 4 }}>
          The arena server is not running, so this game will not be recorded or rated and the local LLM is unreachable.
          Start it with npm run arena-server.
        </Text>
      )}
    </View>
  );
}
