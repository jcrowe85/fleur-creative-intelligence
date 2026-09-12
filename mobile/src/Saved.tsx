import { useState } from "react";
import { FlatList, Image, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { VideoCard } from "./VideoCard";
import type { FeedCard } from "./types";

export function Saved({
  visible,
  cards,
  onClose,
  onRemove,
  onOpenBrief,
}: {
  visible: boolean;
  cards: FeedCard[];
  onClose: () => void;
  onRemove: (id: string) => void;
  onOpenBrief: (card: FeedCard) => void;
}) {
  const { width, height } = useWindowDimensions();
  const [playing, setPlaying] = useState<FeedCard | null>(null);
  const [muted, setMuted] = useState(false);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.back}>
            <Ionicons name="chevron-back" size={26} color="#fff" />
          </Pressable>
          <Text style={styles.title}>Your shot list</Text>
        </View>

        {cards.length === 0 ? (
          <Text style={styles.empty}>Nothing saved yet. Tap the bookmark on ideas you want to make.</Text>
        ) : (
          <FlatList
            data={cards}
            keyExtractor={(c) => c.id}
            contentContainerStyle={{ padding: 16, gap: 12 }}
            renderItem={({ item }) => (
              <Pressable style={styles.row} onPress={() => setPlaying(item)}>
                <View style={styles.thumb}>
                  {item.thumbUrl ? <Image source={{ uri: item.thumbUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
                  <View style={styles.playBadge}>
                    <Ionicons name="play" size={16} color="#fff" />
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.rowTop}>
                    <Text style={styles.brand} numberOfLines={1}>
                      {item.brand}
                    </Text>
                    <Pressable onPress={() => onRemove(item.id)} hitSlop={10}>
                      <Ionicons name="close" size={18} color="rgba(255,255,255,0.5)" />
                    </Pressable>
                  </View>
                  {item.hookText ? (
                    <Text style={styles.hook} numberOfLines={2}>
                      &ldquo;{item.hookText}&rdquo;
                    </Text>
                  ) : null}
                  <Text style={styles.meta}>
                    {item.pillar} · {item.daysRunning ?? "?"}d
                  </Text>
                </View>
              </Pressable>
            )}
          />
        )}
      </View>

      {/* replay a saved video full-screen */}
      {playing ? (
        <View style={StyleSheet.absoluteFill}>
          <VideoCard
            card={playing}
            active
            muted={muted}
            width={width}
            height={height}
            isSaved
            onToggleMute={() => setMuted((m) => !m)}
            onToggleSave={() => {
              onRemove(playing.id);
              setPlaying(null);
            }}
            onOpenBrief={() => onOpenBrief(playing)}
          />
          <Pressable onPress={() => setPlaying(null)} hitSlop={10} style={styles.replayBack}>
            <Ionicons name="chevron-back" size={28} color="#fff" />
          </Pressable>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0a0a" },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 56, paddingBottom: 14, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.1)" },
  back: { padding: 4 },
  title: { color: "#fff", fontSize: 17, fontWeight: "700" },
  empty: { color: "rgba(255,255,255,0.6)", fontSize: 14, padding: 24 },
  row: { flexDirection: "row", gap: 12, backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 14, padding: 12 },
  thumb: { height: 96, width: 64, borderRadius: 10, overflow: "hidden", backgroundColor: "#000" },
  playBadge: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.2)" },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  brand: { color: "#fff", fontSize: 14, fontWeight: "700", flex: 1 },
  hook: { color: "rgba(255,255,255,0.6)", fontSize: 13, marginTop: 2 },
  meta: { color: "rgba(255,255,255,0.5)", fontSize: 11, marginTop: 6 },
  replayBack: { position: "absolute", top: 52, left: 12, height: 40, width: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
});
