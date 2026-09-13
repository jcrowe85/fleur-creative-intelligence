import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View, type ViewToken } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from "expo-video";
import { fetchExamples, saveContentTypes, type ContentTypeExample } from "./api";
import { AnimatedSplash } from "./AnimatedSplash";

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [types, setTypes] = useState<ContentTypeExample[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [personalizing, setPersonalizing] = useState(false);

  useEffect(() => {
    fetchExamples()
      .then((t) => setTypes(t.filter((x) => x.card?.mediaUrl)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    setVisible(new Set(viewableItems.map((v) => String(v.key))));
  });
  const viewConfig = useRef({ itemVisiblePercentThreshold: 40 });

  const toggle = (key: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const submit = async () => {
    setPersonalizing(true);
    try {
      await saveContentTypes([...selected]);
    } catch {
      /* saved best-effort; feed still works */
    }
    setTimeout(onDone, 1700);
  };

  if (personalizing) return <Personalizing />;

  // Same load screen as the feed — the splash carries the wait, no spinner.
  if (loading) return <AnimatedSplash />;

  return (
    <View style={styles.root}>
      <FlatList
        data={types}
        keyExtractor={(t) => t.key}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120, paddingTop: 72 }}
        ListHeaderComponent={
          <View style={{ marginBottom: 20 }}>
            <Text style={styles.h1}>What do you create?</Text>
            <Text style={styles.sub}>Pick everything that fits — we&rsquo;ll tailor your feed from the first scroll.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Card item={item} selected={selected.has(item.key)} active={visible.has(item.key)} onToggle={() => toggle(item.key)} />
        )}
        onViewableItemsChanged={onViewable.current}
        viewabilityConfig={viewConfig.current}
        showsVerticalScrollIndicator={false}
      />
      <View style={styles.footer}>
        <Pressable
          onPress={submit}
          disabled={selected.size === 0}
          style={[styles.cta, selected.size === 0 && styles.ctaOff]}
        >
          <Text style={[styles.ctaText, selected.size === 0 && styles.ctaTextOff]}>
            {selected.size === 0 ? "Select at least one" : `Continue${selected.size > 1 ? ` (${selected.size})` : ""}`}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function Card({
  item,
  selected,
  active,
  onToggle,
}: {
  item: ContentTypeExample;
  selected: boolean;
  active: boolean;
  onToggle: () => void;
}) {
  const url = item.card?.mediaUrl ?? null;
  const player = useVideoPlayer(url ? { uri: url } : null, (p) => {
    p.loop = true;
    p.muted = true;
  });
  useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [active, player]);

  return (
    <Pressable onPress={onToggle} style={[styles.card, selected && styles.cardSel]}>
      <View style={styles.preview}>
        {item.card?.thumbUrl ? <Image source={{ uri: item.card.thumbUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        {url ? <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{item.label}</Text>
        <Text style={styles.cardDesc}>{item.description}</Text>
      </View>
      <View style={[styles.check, selected && styles.checkOn]}>
        {selected ? <Ionicons name="checkmark" size={16} color="#000" /> : null}
      </View>
    </Pressable>
  );
}

function Personalizing() {
  const rows = ["Reading your creative lanes", "Tuning the feed to what you make", "Setting up your recommendations"];
  return (
    <View style={styles.center}>
      <ActivityIndicator color="#fff" style={{ marginBottom: 24 }} />
      <Text style={styles.pTitle}>Personalizing your feed</Text>
      <View style={{ marginTop: 24, gap: 14 }}>
        {rows.map((r) => (
          <View key={r} style={styles.pRow}>
            <Ionicons name="checkmark-circle" size={22} color="#4ade80" />
            <Text style={styles.pRowText}>{r}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0b0b0c" },
  center: { flex: 1, backgroundColor: "#0b0b0c", alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  h1: { color: "#fff", fontSize: 32, fontWeight: "800", letterSpacing: -0.5 },
  sub: { color: "rgba(255,255,255,0.6)", fontSize: 15, lineHeight: 21, marginTop: 10 },
  card: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 18, padding: 12, marginBottom: 12, borderWidth: 1.5, borderColor: "transparent" },
  cardSel: { borderColor: "#fff", backgroundColor: "rgba(255,255,255,0.1)" },
  preview: { width: 72, height: 112, borderRadius: 12, overflow: "hidden", backgroundColor: "#000" },
  cardTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  cardDesc: { color: "rgba(255,255,255,0.6)", fontSize: 13, lineHeight: 18, marginTop: 4 },
  check: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: "rgba(255,255,255,0.4)", alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: "#fff", borderColor: "#fff" },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 20, paddingBottom: 36, backgroundColor: "rgba(11,11,12,0.9)" },
  cta: { backgroundColor: "#fff", borderRadius: 999, paddingVertical: 16, alignItems: "center" },
  ctaOff: { backgroundColor: "rgba(255,255,255,0.12)" },
  ctaText: { color: "#000", fontSize: 16, fontWeight: "700" },
  ctaTextOff: { color: "rgba(255,255,255,0.5)" },
  pTitle: { color: "#fff", fontSize: 20, fontWeight: "700" },
  pRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  pRowText: { color: "rgba(255,255,255,0.85)", fontSize: 15 },
});
