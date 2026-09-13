import { useState } from "react";
import { FlatList, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Directions, Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { FadeIn, runOnJS, withSpring, type SharedValue } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { VideoCard } from "./VideoCard";
import { BriefSheet } from "./BriefSheet";
import { StudyScreen } from "./StudyScreen";
import type { FeedCard } from "./types";

const COLS = 3;
const GAP = 6;
// Tiles arrive on a short stagger so the grid assembles rather than appears.
const ATile = Animated.createAnimatedComponent(Pressable);
const COMMIT_RATIO = 0.3;
const COMMIT_VELOCITY = 800;
const SPRING = { damping: 22, stiffness: 220, mass: 0.7 };

const clock = (secs: number | null) => {
  if (secs == null || secs <= 0) return null;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

export function Saved({
  cards,
  x,
  onClose,
  onRemove,
}: {
  cards: FeedCard[];
  /** Shared with App: this screen's horizontal offset, so the drag back out
   *  moves the screen itself rather than waiting on a transition. */
  x: SharedValue<number>;
  onClose: () => void;
  onRemove: (id: string) => void;
}) {
  const { width, height } = useWindowDimensions();
  const [playing, setPlaying] = useState<FeedCard | null>(null);
  const [muted, setMuted] = useState(false);

  // The brief/brainstorm sheet lives in here so it belongs to this screen.
  const [sheetCard, setSheetCard] = useState<FeedCard | null>(null);
  const [sheetTab, setSheetTab] = useState<"brief" | "chat">("brief");
  const [studyCard, setStudyCard] = useState<FeedCard | null>(null);

  const openSheet = (card: FeedCard, tab: "brief" | "chat") => {
    setSheetTab(tab);
    setSheetCard(card);
  };

  // Drag right to push this screen back off to the side — the mirror of the
  // pull that brought it in.
  const backPan = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-20, 20])
    .onUpdate((e) => {
      if (e.translationX < 0) return;
      x.value = Math.min(width, e.translationX);
    })
    .onEnd((e) => {
      if (e.translationX > width * COMMIT_RATIO || e.velocityX > COMMIT_VELOCITY) {
        x.value = withSpring(width, SPRING);
        runOnJS(onClose)();
      } else {
        x.value = withSpring(0, SPRING);
      }
    });

  // Inside a replay, swiping right returns to the grid rather than leaving.
  const replayFling = Gesture.Fling().direction(Directions.RIGHT).runOnJS(true).onEnd(() => setPlaying(null));

  const tile = Math.floor((width - GAP * (COLS + 1)) / COLS);

  return (
    <View style={styles.root}>
      <GestureDetector gesture={backPan}>
        <View style={{ flex: 1 }}>
          <View style={styles.header}>
            <Pressable onPress={onClose} hitSlop={10} style={styles.back}>
              <Ionicons name="chevron-back" size={26} color="#fff" />
            </Pressable>
            <Text style={styles.title}>Your shot list</Text>
            {cards.length > 0 ? <Text style={styles.count}>{cards.length}</Text> : null}
          </View>

          {cards.length === 0 ? (
            <Text style={styles.empty}>Nothing saved yet. Tap the bookmark on ideas you want to make.</Text>
          ) : (
            <FlatList
              data={cards}
              keyExtractor={(c) => c.id}
              numColumns={COLS}
              columnWrapperStyle={{ gap: GAP, paddingHorizontal: GAP }}
              contentContainerStyle={{ gap: GAP, paddingVertical: GAP }}
              renderItem={({ item, index }) => {
                const len = clock(item.durationSec);
                return (
                  <ATile
                    onPress={() => setPlaying(item)}
                    style={[styles.tile, { width: tile, height: tile * (16 / 9) }]}
                    entering={FadeIn.delay(Math.min(index, 11) * 28).duration(240)}
                  >
                    {item.thumbUrl ? (
                      <Image source={{ uri: item.thumbUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                    ) : null}

                    {/* remove without opening — creators prune this list fast */}
                    <Pressable onPress={() => onRemove(item.id)} hitSlop={8} style={styles.tileX}>
                      <Ionicons name="close" size={13} color="#fff" />
                    </Pressable>

                    <View style={styles.tileFoot}>
                      <Ionicons name="play" size={11} color="#fff" />
                      {len ? <Text style={styles.tileLen}>{len}</Text> : null}
                    </View>
                  </ATile>
                );
              }}
            />
          )}
        </View>
      </GestureDetector>

      {/* replay a saved video full-screen */}
      {playing ? (
        <GestureDetector gesture={replayFling}>
          <View style={StyleSheet.absoluteFill}>
            <VideoCard
              card={playing}
              active
              paused={sheetCard !== null || studyCard !== null}
              muted={muted}
              width={width}
              height={height}
              isSaved
              onToggleMute={() => setMuted((m) => !m)}
              onToggleSave={() => {
                onRemove(playing.id);
                setPlaying(null);
              }}
              onOpenBrief={() => setStudyCard(playing)}
              onOpenChat={() => openSheet(playing, "chat")}
            />
            <Pressable onPress={() => setPlaying(null)} hitSlop={10} style={styles.replayBack}>
              <Ionicons name="chevron-back" size={28} color="#fff" />
            </Pressable>
          </View>
        </GestureDetector>
      ) : null}

      <BriefSheet card={sheetCard} initialTab={sheetTab} onClose={() => setSheetCard(null)} />
      <StudyScreen card={studyCard} onClose={() => setStudyCard(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0a0a" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 56,
    paddingBottom: 14,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  back: { padding: 4 },
  title: { color: "#fff", fontSize: 17, fontWeight: "700", flex: 1 },
  count: { color: "rgba(255,255,255,0.5)", fontSize: 15, fontWeight: "600" },
  empty: { color: "rgba(255,255,255,0.6)", fontSize: 14, padding: 24 },
  tile: { borderRadius: 8, overflow: "hidden", backgroundColor: "#151515" },
  tileX: {
    position: "absolute",
    top: 4,
    right: 4,
    height: 22,
    width: 22,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  tileFoot: { position: "absolute", left: 6, bottom: 6, flexDirection: "row", alignItems: "center", gap: 4 },
  tileLen: { color: "#fff", fontSize: 11, fontWeight: "600", textShadowColor: "rgba(0,0,0,0.8)", textShadowRadius: 3 },
  replayBack: {
    position: "absolute",
    top: 52,
    left: 12,
    height: 40,
    width: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
});
