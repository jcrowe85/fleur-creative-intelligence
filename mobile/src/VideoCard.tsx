import { useEffect } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from "expo-video";
import type { FeedCard } from "./types";

const compact = (n: number | null) =>
  n == null ? "—" : Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);

export function VideoCard({
  card,
  active,
  muted,
  width,
  height,
  isSaved,
  onToggleMute,
  onToggleSave,
  onOpenBrief,
}: {
  card: FeedCard;
  active: boolean;
  muted: boolean;
  width: number;
  height: number;
  isSaved: boolean;
  onToggleMute: () => void;
  onToggleSave: () => void;
  onOpenBrief: () => void;
}) {
  // One native player per card. Native playback = no autoplay/gesture restriction
  // and proper buffering, so sound and playback are reliable (the whole reason we
  // moved off the web feed).
  const player = useVideoPlayer(card.mediaUrl ? { uri: card.mediaUrl } : null, (p) => {
    p.loop = true;
    p.muted = muted;
  });

  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  useEffect(() => {
    if (active) {
      player.play();
    } else {
      player.pause();
      player.currentTime = 0;
    }
  }, [active, player]);

  return (
    <View style={{ width, height, backgroundColor: "#000" }}>
      {card.thumbUrl ? (
        <Image source={{ uri: card.thumbUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : null}
      {card.mediaUrl ? (
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
      ) : null}

      {/* legibility scrims */}
      <View style={styles.topScrim} pointerEvents="none" />
      <View style={styles.bottomScrim} pointerEvents="none" />

      {/* top-left: brand + thin badge */}
      <View style={styles.topLeft} pointerEvents="none">
        <Text style={styles.brand}>{card.brand}</Text>
        {card.thinForFleur ? (
          <View style={styles.thinBadge}>
            <Ionicons name="trending-up" size={12} color="#fde68a" />
            <Text style={styles.thinText}>you&rsquo;re thin here</Text>
          </View>
        ) : null}
      </View>

      {/* bottom-left: hook + chips + durability */}
      <View style={styles.bottomLeft} pointerEvents="none">
        {card.hookText ? (
          <Text style={styles.hook} numberOfLines={3}>
            &ldquo;{card.hookText}&rdquo;
          </Text>
        ) : null}
        <View style={styles.chipRow}>
          <Chip>{card.pillar}</Chip>
          {card.persona !== "none" ? <Chip>{card.persona}</Chip> : null}
          <Chip>{card.funnel}</Chip>
          <Chip>{card.format}</Chip>
        </View>
        <Text style={styles.stats}>
          {card.daysRunning ?? "?"}d running · {compact(card.reach)} reach · {card.variants ?? "?"} variants
        </Text>
      </View>

      {/* right rail: mute, brief, save */}
      <View style={styles.rail}>
        <RailButton onPress={onToggleMute} icon={muted ? "volume-mute" : "volume-high"} label={muted ? "Muted" : "Sound"} />
        <RailButton onPress={onOpenBrief} icon="sparkles" label="Brief" />
        <RailButton
          onPress={onToggleSave}
          icon={isSaved ? "bookmark" : "bookmark-outline"}
          label={isSaved ? "Saved" : "Save"}
          tint={isSaved ? "#fff" : undefined}
          bg={isSaved ? "#fff" : undefined}
          iconColor={isSaved ? "#000" : "#fff"}
        />
      </View>
    </View>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{children}</Text>
    </View>
  );
}

function RailButton({
  onPress,
  icon,
  label,
  bg,
  iconColor = "#fff",
}: {
  onPress: () => void;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  tint?: string;
  bg?: string;
  iconColor?: string;
}) {
  return (
    <Pressable onPress={onPress} style={styles.railBtn} hitSlop={8}>
      <View style={[styles.railIcon, bg ? { backgroundColor: bg } : null]}>
        <Ionicons name={icon} size={24} color={iconColor} />
      </View>
      <Text style={styles.railLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topScrim: { position: "absolute", top: 0, left: 0, right: 0, height: 120, backgroundColor: "rgba(0,0,0,0.35)" },
  bottomScrim: { position: "absolute", bottom: 0, left: 0, right: 0, height: 320, backgroundColor: "rgba(0,0,0,0.35)" },
  topLeft: { position: "absolute", top: 56, left: 16, flexDirection: "row", alignItems: "center", gap: 8 },
  brand: { color: "#fff", fontSize: 15, fontWeight: "700", textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4 },
  thinBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(245,158,11,0.25)", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  thinText: { color: "#fde68a", fontSize: 11, fontWeight: "600" },
  bottomLeft: { position: "absolute", left: 16, right: 84, bottom: 40, gap: 10 },
  hook: { color: "#fff", fontSize: 16, fontWeight: "500", lineHeight: 21, textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { backgroundColor: "rgba(255,255,255,0.18)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  chipText: { color: "rgba(255,255,255,0.95)", fontSize: 11, fontWeight: "600" },
  stats: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: "500" },
  rail: { position: "absolute", right: 12, bottom: "24%", alignItems: "center", gap: 20 },
  railBtn: { alignItems: "center", gap: 4 },
  railIcon: { height: 48, width: 48, borderRadius: 24, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  railLabel: { color: "rgba(255,255,255,0.9)", fontSize: 11, fontWeight: "600" },
});
