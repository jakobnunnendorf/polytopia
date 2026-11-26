import React, { useContext, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SettingsContext } from "@/context/SettingsContext";
import { PLAYER_COLORS, UI } from "@/components/game/theme";
import { arena, type Profile } from "@/components/game/arenaClient";
import { BUILTIN_MODELS } from "@/logic/agents/registry";
import type { ModelSpec } from "@/logic/agents/types";
import type { Ratings } from "@/logic/arena/elo";
import type { Seat } from "@/logic/arena/record";
import { CLANS, maxPlayersFor } from "@/logic/engine/data";
import { mapSizeAllowed, mapTypeFor, perfectionBonusPercent } from "@/logic/engine/state";
import { name as displayName } from "@/logic/engine/names";
import { tribeDescription } from "@/logic/engine/tribes";
import { TribeEmblem } from "@/components/art/Art";
import { ModelCard } from "./ModelCard";
import { WorldBoard, compass, sampleWorld } from "./WorldBoard";

const MAP_SIZES = [
  { title: "Tiny", size: 11 },
  { title: "Small", size: 14 },
  { title: "Normal", size: 16 },
  { title: "Large", size: 18 },
  { title: "Huge", size: 20 },
  { title: "Massive", size: 30 },
];

const MODES = [
  { id: "perfection", title: "Perfection", hint: "Highest score after 30 turns wins. Always a Normal (16×16) map of Continents, as in the game." },
  { id: "domination", title: "Domination", hint: "The last tribe holding a city wins. The size is preset from the opponent count; pick another if you like." },
  { id: "creative", title: "Creative", hint: "Any size and opponents, no turn limit; the last tribe holding a city wins." },
  { id: "glory", title: "Glory", hint: "First to 10,000 points wins; if several reach it in one turn, the highest score." },
  { id: "might", title: "Might", hint: "Capture every tribe's capital to win; other cities don't count." },
] as const;

const WORLDS = [
  { id: "drylands", title: "Drylands", hint: "All land, no water." },
  { id: "lakes", title: "Lakes", hint: "Mostly land (about three quarters) with lakes." },
  { id: "continents", title: "Continents", hint: "A few large land masses split by water." },
  { id: "pangea", title: "Pangea", hint: "One big continent surrounded by ocean." },
  { id: "archipelago", title: "Archipelago", hint: "Many islands; boats matter early." },
  { id: "waterworld", title: "Water World", hint: "Mostly ocean (about 85%) with small islands." },
] as const;

const DIFFICULTIES = [
  { id: "easy", title: "Easy" },
  { id: "normal", title: "Normal" },
  { id: "hard", title: "Hard" },
  { id: "crazy", title: "Crazy" },
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

/** who sits at the table, e.g. "1 person, 3 models" or "4 models" */
function tableLine(seats: Seat[]): string {
  const people = seats.filter((s) => s.kind === "human").length;
  const bots = seats.length - people;
  const part = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return [people && part(people, "person", "people"), bots && part(bots, "model", "models")].filter(Boolean).join(", ");
}

/** one seat: a human profile (for Elo per local player) or an opponent model */
function SeatRow({
  i,
  seat,
  profiles,
  models,
  ratings,
  overall,
  onChange,
  onNewProfile,
  where,
}: {
  /** where this seat starts in the sample world, in words */
  where?: string;
  i: number;
  seat: Seat;
  profiles: Profile[];
  models: ModelSpec[];
  ratings: Ratings;
  /** the overall table, used when a player has no games with the chosen settings */
  overall: Ratings;
  onChange: (s: Seat) => void;
  onNewProfile: (name: string) => Promise<Profile | null>;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  // the rating for the chosen mode, player count and map size; else the overall one, marked as such
  const elo = (key: string) =>
    ratings[key] ? String(Math.round(ratings[key].rating)) : overall[key] ? `${Math.round(overall[key].rating)} overall` : undefined;
  return (
    <View style={{ paddingTop: 12, paddingBottom: 6, borderTopWidth: 1, borderTopColor: UI.line }} testID="seat-editor">
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: PLAYER_COLORS[i % PLAYER_COLORS.length], marginRight: 8 }} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: UI.mist, fontWeight: "800", fontSize: 15 }}>{i === 0 ? "First to move" : `Seat ${i + 1}`}</Text>
          {where ? <Text style={{ color: UI.muted, fontSize: 12 }}>{`Starts in ${where} of this sample`}</Text> : null}
        </View>
        <Chip label="Person" on={seat.kind === "human"} onPress={() => onChange({ kind: "human", profileId: GUEST.id, name: GUEST.name })} />
        <Chip label="Model" on={seat.kind === "model"} onPress={() => onChange({ kind: "model", modelId: models[0]?.id ?? "greedy-v1" })} />
      </View>
      {seat.kind === "model" && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>
          {models.map((m, rank) => {
            const own = ratings[`model:${m.id}`];
            const r = own ?? overall[`model:${m.id}`];
            return (
              <ModelCard
                key={m.id}
                model={m}
                all={models}
                rank={rank + 1}
                elo={r ? Math.round(r.rating) : undefined}
                overall={!own}
                on={seat.modelId === m.id}
                onPress={() => onChange({ ...seat, kind: "model", modelId: m.id })}
              />
            );
          })}
        </View>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {seat.kind === "model"
          ? null
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
        <Chip
          label="Random tribe"
          on={!seat.clan}
          onPress={() => onChange({ ...seat, clan: undefined })}
        />
        {CLANS.map((c) => {
          const active = seat.clan === c.id;
          return (
            <Pressable
              key={c.id}
              testID={`seat-${i}-tribe-${c.id}`}
              onPress={() => onChange({ ...seat, clan: c.id })}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 999,
                marginRight: 8,
                marginBottom: 8,
                backgroundColor: active ? UI.mist : "#142442",
                borderWidth: 1.5,
                borderColor: active ? UI.gold : c.special ? "#ffd23f88" : UI.line,
              }}
            >
              <TribeEmblem clan={c.id} size={20} />
              <Text style={{ color: active ? UI.dusk : UI.mist, fontWeight: "700", fontSize: 13, marginLeft: 6 }}>
                {c.special ? "★ " : ""}{displayName("clan", c.id)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <TribeNote clan={seat.clan} />
    </View>
  );
}

/** what the chosen tribe starts with and what makes it different */
function TribeNote({ clan }: { clan?: string }) {
  if (!clan) {
    return <Text style={{ color: UI.muted, fontSize: 12, lineHeight: 17 }}>A tribe is dealt at random when the game starts.</Text>;
  }
  const d = tribeDescription(clan);
  return (
    <Text testID={`tribe-note-${clan}`} style={{ color: UI.muted, fontSize: 12, lineHeight: 17 }}>
      <Text style={{ color: UI.mist, fontWeight: "700" }}>{displayName("clan", clan)}: </Text>
      {d.start} {d.character}
    </Text>
  );
}

/**
 * the models the picker offers: no superseded (hidden) models, strongest first by
 * overall Elo, so a new model seat starts with the champion
 */
export function pickerModels(models: ModelSpec[], overall: Ratings): ModelSpec[] {
  const elo = (m: ModelSpec) => overall[`model:${m.id}`]?.rating ?? -Infinity;
  return models.filter((m) => !m.hidden).sort((a, b) => elo(b) - elo(a));
}

export default function Settings() {
  const settings = useContext(SettingsContext);
  const mode = MODES.find((m) => m.id === settings.gameMode) ?? MODES[0];
  // the world the mode forces (Perfection: Continents), shown as the only choice
  const forcedWorld = mapTypeFor(mode.id);
  const [models, setModels] = useState<ModelSpec[]>(() => pickerModels(BUILTIN_MODELS, {}));
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [ratings, setRatings] = useState<Ratings>({});
  const [overall, setOverall] = useState<Ratings>({});
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([arena.models(), arena.profiles(), arena.ratings()])
      .then(([m, p, r]) => {
        if (!live) return;
        if (m.length) setModels(pickerModels(m, r));
        setProfiles(p);
        setOverall(r);
        setOnline(true);
      })
      .catch(() => live && setOnline(false));
    return () => {
      live = false;
    };
  }, []);

  const seats = settings.seats;
  // ratings fitted on games with exactly these settings, refetched when they change
  useEffect(() => {
    let live = true;
    arena
      .ratings({ mode: mode.id, players: seats.length, size: settings.mapSize })
      .then((r) => live && setRatings(r))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [mode.id, seats.length, settings.mapSize]);
  // the Seats board: one world the engine could deal for these settings (a fixed sample seed)
  const [selected, setSelected] = useState(0);
  const sel = Math.min(selected, seats.length - 1);
  const world = useMemo(
    () => sampleWorld({ mapSize: settings.mapSize, players: seats.length, mode: mode.id, mapType: settings.mapType, seed: 7932 }),
    [settings.mapSize, seats.length, mode.id, settings.mapType],
  );
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

  // the Players count, as in the game: pick how many first, then who sits where
  const maxPlayers = Math.min(16, Math.max(...MAP_SIZES.filter((m) => mapSizeAllowed(mode.id, m.size)).map((m) => maxPlayersFor(m.size))));
  const resize = (n: number) => {
    const target = Math.max(2, Math.min(maxPlayers, n));
    let next = [...seats];
    while (next.length < target) next.push({ kind: "model", modelId: models[0]?.id ?? "greedy-v1" });
    while (next.length > target) {
      const j = next.map((s) => s.kind).lastIndexOf("model");
      next.splice(j >= 0 ? j : next.length - 1, 1);
    }
    settings.setSeats(next);
    setSelected((s) => Math.min(s, target - 1));
  };

  const sizes = MAP_SIZES.filter((m) => mapSizeAllowed(mode.id, m.size) && seats.length <= maxPlayersFor(m.size));

  return (
    <View testID="settings-component">
      <Heading>Victory</Heading>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {MODES.map((m) => (
          <Chip key={m.id} testID={`mode-${m.id}`} label={m.title} on={mode.id === m.id} onPress={() => settings.setGameMode(m.id)} />
        ))}
      </View>
      <Text style={{ color: UI.muted, fontSize: 13 }}>{mode.hint}</Text>

      {/* a choice the mode fixes (Perfection: Continents, Normal size) is not shown; the mode's hint names it */}
      {!forcedWorld && (
        <>
          <Heading>World</Heading>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {WORLDS.map((w) => (
              <Chip key={w.id} testID={`world-${w.id}`} label={w.title} on={settings.mapType === w.id} onPress={() => settings.setMapType(w.id)} />
            ))}
          </View>
          <Text style={{ color: UI.muted, fontSize: 13 }}>{WORLDS.find((w) => w.id === settings.mapType)?.hint}</Text>
        </>
      )}

      {sizes.length > 1 && (
        <>
          <Heading>Map size</Heading>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {sizes.map((m) => (
              <Chip key={m.size} label={m.title} on={settings.mapSize === m.size} onPress={() => settings.setMapSize(m.size)} />
            ))}
          </View>
        </>
      )}

      <Heading>Players</Heading>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Chip testID="players-less" label="−" on={false} onPress={() => resize(seats.length - 1)} />
        <Text testID="players-count" style={{ color: UI.mist, fontWeight: "800", fontSize: 18, minWidth: 34, textAlign: "center", marginBottom: 8 }}>
          {seats.length}
        </Text>
        <Chip testID="players-more" label="+" on={false} onPress={() => resize(seats.length + 1)} />
        <Text style={{ color: UI.muted, fontSize: 13, marginLeft: 6, marginBottom: 8 }}>{tableLine(seats)}</Text>
      </View>

      <Heading>Difficulty</Heading>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {DIFFICULTIES.map((d) => (
          <Chip
            key={d.id}
            testID={`difficulty-${d.id}`}
            label={d.title}
            on={settings.difficulty === d.id}
            onPress={() => settings.setDifficulty(d.id)}
          />
        ))}
      </View>
      {mode.id === "perfection" && (
        <Text testID="perfection-bonus" style={{ color: UI.muted, fontSize: 13 }}>
          {`Difficulty bonus: ${perfectionBonusPercent(settings.difficulty, seats.length - 1)}%`}
        </Text>
      )}

      <Heading>Seats</Heading>
      <WorldBoard
        seats={seats}
        models={models}
        ratings={ratings}
        overall={overall}
        world={world}
        dealKey={`${seats.length}-${settings.mapSize}-${settings.mapType}-${mode.id}`}
        selected={sel}
        onSelect={setSelected}
      />
      <SeatRow
        key={sel}
        i={sel}
        seat={seats[sel]}
        where={world ? compass(world.capitals[sel], world.n) : undefined}
        profiles={profiles}
        models={models}
        ratings={ratings}
        overall={overall}
        onChange={(s) => setSeat(sel, s)}
        onNewProfile={newProfile}
      />
      {online === false && (
        <Text style={{ color: UI.coral, fontSize: 13, lineHeight: 18, marginTop: 4 }}>
          The arena server is not running, so this game will not be recorded or rated.
          Start it with npm run arena-server.
        </Text>
      )}
    </View>
  );
}
