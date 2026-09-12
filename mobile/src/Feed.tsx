import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, type ViewToken, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { VideoCard } from "./VideoCard";
import { fetchFeed } from "./api";
import type { FeedCard } from "./types";

export function Feed({
  savedIds,
  onToggleSave,
  onOpenBrief,
  onOpenSaved,
}: {
  savedIds: Set<string>;
  onToggleSave: (card: FeedCard) => void;
  onOpenBrief: (card: FeedCard) => void;
  onOpenSaved: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const [cards, setCards] = useState<FeedCard[]>([]);
  const [active, setActive] = useState(0);
  const [soundOn, setSoundOn] = useState(true); // native: sound-on just works
  const [loading, setLoading] = useState(true);
  const loadingMore = useRef(false);

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

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <FlatList
        data={cards}
        keyExtractor={(c) => c.id}
        renderItem={({ item, index }) => (
          <VideoCard
            card={item}
            active={index === active}
            muted={!soundOn}
            width={width}
            height={height}
            isSaved={savedIds.has(item.id)}
            onToggleMute={() => setSoundOn((s) => !s)}
            onToggleSave={() => onToggleSave(item)}
            onOpenBrief={() => onOpenBrief(item)}
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
      <Pressable style={styles.savedPill} onPress={onOpenSaved} hitSlop={8}>
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
