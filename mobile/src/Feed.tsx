import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View, type ViewToken, useWindowDimensions } from "react-native";
import { type GestureType } from "react-native-gesture-handler";
import { Ionicons } from "@expo/vector-icons";
import { VideoCard } from "./VideoCard";
import { fetchFeed } from "./api";
import { AnimatedSplash } from "./AnimatedSplash";
import type { FeedCard } from "./types";

export function Feed({
  savedIds,
  suspended = false,
  onToggleSave,
  onSkip,
  onOpenBrief,
  onOpenChat,
  onOpenSaved,
  onResetData,
  outerGesture,
}: {
  savedIds: Set<string>;
  /** Something is covering the feed — hold playback where it is. */
  suspended?: boolean;
  onToggleSave: (card: FeedCard) => void;
  onSkip: (id: string) => void;
  onOpenBrief: (card: FeedCard) => void;
  onOpenChat: (card: FeedCard) => void;
  onOpenSaved: () => void;
  /** Long-press escape hatch on the saved pill — start over as a new creator. */
  onResetData: () => void;
  /** Passed to each card so scrubbing can block the screen-level swipe. */
  outerGesture?: GestureType;
}) {
  const { width, height } = useWindowDimensions();
  const [cards, setCards] = useState<FeedCard[]>([]);
  const [active, setActive] = useState(0);
  const [soundOn, setSoundOn] = useState(true); // native: sound-on just works
  const [loading, setLoading] = useState(true);
  const loadingMore = useRef(false);
  const prevActive = useRef(0);
  const skipped = useRef<Set<string>>(new Set());

  useEffect(() => {
    fetchFeed()
      .then((c) => setCards(c))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore.current) return;
    loadingMore.current = true;
    try {
      const more = await fetchFeed();
      setCards((prev) => {
        const have = new Set(prev.map((c) => c.id));
        const fresh = more.filter((c) => !have.has(c.id));
        return fresh.length ? [...prev, ...fresh] : prev;
      });
    } catch {
      /* retry next end-reached */
    } finally {
      loadingMore.current = false;
    }
  }, []);

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((v) => v.isViewable);
    if (first?.index != null) setActive(first.index);
  });
  const viewConfig = useRef({ itemVisiblePercentThreshold: 60 });

  // Scrolling PAST a video (moving forward) is a soft "skip": record it dismissed
  // so it won't repeat and the feed learns a mild negative — UNLESS it was saved,
  // in which case the save stands and no skip is recorded (so a save never nets out).
  useEffect(() => {
    for (let k = prevActive.current; k < active; k++) {
      const c = cards[k];
      if (c && !savedIds.has(c.id) && !skipped.current.has(c.id)) {
        skipped.current.add(c.id);
        onSkip(c.id);
      }
    }
    prevActive.current = active;
  }, [active, cards, savedIds, onSkip]);

  // Hold the splash until the first cards land, so there's no spinner seam
  // between the load screen and the feed.
  if (loading) return <AnimatedSplash />;

  // The swipe-left that opens the saved screen lives in App, where it can move
  // that screen with the finger.
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <FlatList
        data={cards}
        keyExtractor={(c) => c.id}
        renderItem={({ item, index }) => (
          <VideoCard
            card={item}
            active={index === active}
            paused={suspended}
            muted={!soundOn}
            width={width}
            height={height}
            isSaved={savedIds.has(item.id)}
            outerGesture={outerGesture}
            onToggleMute={() => setSoundOn((s) => !s)}
            onToggleSave={() => onToggleSave(item)}
            onOpenBrief={() => onOpenBrief(item)}
            onOpenChat={() => onOpenChat(item)}
          />
        )}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        decelerationRate="fast"
        windowSize={3}
        maxToRenderPerBatch={2}
        initialNumToRender={2}
        removeClippedSubviews
        getItemLayout={(_, i) => ({ length: height, offset: height * i, index: i })}
        onViewableItemsChanged={onViewable.current}
        viewabilityConfig={viewConfig.current}
        onEndReached={loadMore}
        onEndReachedThreshold={2}
      />
      <Pressable
        style={styles.savedPill}
        onPress={onOpenSaved}
        onLongPress={() =>
          Alert.alert(
            "Reset data?",
            "Starts over as a brand-new creator: saves cleared, onboarding again. Your old data stays on the server, it just won't be yours any more.",
            [
              { text: "Cancel", style: "cancel" },
              { text: "Reset", style: "destructive", onPress: onResetData },
            ],
          )
        }
        delayLongPress={600}
        hitSlop={8}
      >
        <Ionicons name="bookmark" size={16} color="#fff" />
        <Text style={styles.savedCount}>{savedIds.size}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  savedPill: {
    position: "absolute",
    top: 56,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.45)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  savedCount: { color: "#fff", fontSize: 14, fontWeight: "600" },
});
