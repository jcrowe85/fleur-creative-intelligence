import { useEffect, useMemo, useState } from "react";
import { useEvent } from "expo";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector, type GestureType } from "react-native-gesture-handler";
import Animated, { ZoomIn, ZoomOut, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useVideoPlayer, VideoView } from "expo-video";
import type { FeedCard } from "./types";

const compact = (n: number | null) =>
  n == null ? "—" : Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);

const clock = (secs: number) => {
  if (!Number.isFinite(secs) || secs < 0) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

export function VideoCard({
  card,
  active,
  paused = false,
  muted,
  width,
  height,
  isSaved,
  outerGesture,
  onToggleMute,
  onToggleSave,
  onOpenBrief,
  onOpenChat,
}: {
  card: FeedCard;
  active: boolean;
  /** Held open by something above the feed (the saved list, say) — stop playing
   *  but keep our place, unlike scrolling away which rewinds. */
  paused?: boolean;
  muted: boolean;
  width: number;
  height: number;
  isSaved: boolean;
  /** The screen-level swipe gesture, so scrubbing can block it — otherwise
   *  dragging the bar leftwards would also drag the saved screen in. */
  outerGesture?: GestureType;
  onToggleMute: () => void;
  onToggleSave: () => void;
  onOpenBrief: () => void;
  /** Opens the sheet straight on the brainstorm tab. Omitted = no rail button. */
  onOpenChat?: () => void;
}) {
  // One native player per card. Native playback = no autoplay/gesture restriction
  // and proper buffering, so sound and playback are reliable (the whole reason we
  // moved off the web feed).
  const player = useVideoPlayer(card.mediaUrl ? { uri: card.mediaUrl } : null, (p) => {
    p.loop = true;
    p.muted = muted;
    // Without an interval the player emits no timeUpdate at all, and the bar
    // would never move.
    p.timeUpdateEventInterval = 0.25;
  });

  const [scrubbing, setScrubbing] = useState(false);
  const [scrubRatio, setScrubRatio] = useState(0);
  // Whether the creator *chose* to pause (tap). Distinct from "not playing yet
  // because it's still loading" — only a chosen pause shows the play glyph.
  const [userPaused, setUserPaused] = useState(false);

  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  useEffect(() => {
    if (!active) {
      player.pause();
      player.currentTime = 0;
      setUserPaused(false);
      return;
    }
    if (paused) {
      player.pause();
      return;
    }
    player.play();
    setUserPaused(false);
  }, [active, paused, player]);

  // Player properties don't drive React state, so the paused glyph listens to
  // the player's own event instead of reading player.playing on each render.
  const { isPlaying } = useEvent(player, "playingChange", { isPlaying: player.playing });
  const { currentTime } = useEvent(player, "timeUpdate", {
    currentTime: player.currentTime,
    bufferedPosition: player.bufferedPosition,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
  });

  const { status } = useEvent(player, "statusChange", { status: player.status });

  const duration = player.duration;
  const hasTrack = !!card.mediaUrl && Number.isFinite(duration) && duration > 0;
  // While dragging, the finger is the source of truth — timeUpdate lags behind
  // the seek and would make the bar stutter backwards.
  const progress = scrubbing ? scrubRatio : duration > 0 ? Math.min(1, currentTime / duration) : 0;

  const togglePlay = () => {
    if (player.playing) {
      player.pause();
      setUserPaused(true);
    } else {
      player.play();
      setUserPaused(false);
    }
  };

  // Buffering cue: no center loader. If the active video is still loading after a
  // 1s grace (give it a chance to start on its own), flash the bottom timeline
  // instead — TikTok-style.
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    if (active && !userPaused && status === "loading") {
      const t = setTimeout(() => setWaiting(true), 1000);
      return () => clearTimeout(t);
    }
    setWaiting(false);
  }, [status, active, userPaused]);

  const flash = useSharedValue(1);
  useEffect(() => {
    flash.value = waiting
      ? withRepeat(withTiming(0.25, { duration: 500 }), -1, true)
      : withTiming(1, { duration: 200 });
  }, [waiting, flash]);
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));

  // The bar swells under the thumb instead of jumping to its bigger size.
  const grow = useSharedValue(0);
  useEffect(() => {
    grow.value = withTiming(scrubbing ? 1 : 0, { duration: 160 });
  }, [scrubbing, grow]);
  const trackStyle = useAnimatedStyle(() => ({
    height: 2.5 + grow.value * 2.5,
    borderRadius: 2 + grow.value,
  }));

  const scrub = useMemo(() => {
    const seekTo = (x: number) => {
      const d = player.duration;
      if (!Number.isFinite(d) || d <= 0) return;
      const ratio = Math.min(1, Math.max(0, x / width));
      setScrubRatio(ratio);
      player.currentTime = ratio * d;
    };

    // runOnJS: these touch the player and React state directly.
    const g = Gesture.Pan()
      .minDistance(0)
      .runOnJS(true)
      .onBegin((e) => {
        setScrubbing(true);
        seekTo(e.x);
      })
      .onUpdate((e) => seekTo(e.x))
      .onEnd(() => setScrubbing(false))
      .onFinalize(() => setScrubbing(false));

    return outerGesture ? g.blocksExternalGesture(outerGesture) : g;
  }, [outerGesture, player, width]);

  return (
    <View style={{ width, height, backgroundColor: "#000" }}>
      {card.thumbUrl ? (
        <Image source={{ uri: card.thumbUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : null}
      {card.mediaUrl ? (
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
      ) : null}

      {/* Tap anywhere on the frame to pause or resume. This sits above the video
          but below the rail, so the rail buttons keep their own taps. */}
      {card.mediaUrl ? (
        <Pressable style={StyleSheet.absoluteFill} onPress={togglePlay}>
          {active && userPaused && !scrubbing ? (
            <View style={styles.pausedWrap} pointerEvents="none">
              <Animated.View
                style={styles.pausedGlyph}
                entering={ZoomIn.duration(180)}
                exiting={ZoomOut.duration(140)}
              >
                <Ionicons name="play" size={44} color="#fff" style={{ marginLeft: 5 }} />
              </Animated.View>
            </View>
          ) : null}
        </Pressable>
      ) : null}

      {/* legibility scrims — real gradients, not flat boxes */}
      <LinearGradient colors={["rgba(0,0,0,0.55)", "transparent"]} style={styles.topScrim} pointerEvents="none" />
      <LinearGradient colors={["transparent", "rgba(0,0,0,0.9)"]} style={styles.bottomScrim} pointerEvents="none" />

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

      {/* right rail: mute, brief, brainstorm, save */}
      <View style={styles.rail}>
        <RailButton onPress={onToggleMute} icon={muted ? "volume-mute" : "volume-high"} label={muted ? "Muted" : "Sound"} />
        <RailButton onPress={onOpenBrief} icon="sparkles" label="Brief" />
        {onOpenChat ? (
          <RailButton onPress={onOpenChat} icon="chatbubble-ellipses-outline" label="Brainstorm" />
        ) : null}
        <RailButton
          onPress={() => {
            // A save is a decision worth feeling.
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            onToggleSave();
          }}
          icon={isSaved ? "bookmark" : "bookmark-outline"}
          label={isSaved ? "Saved" : "Save"}
          tint={isSaved ? "#fff" : undefined}
          bg={isSaved ? "#fff" : undefined}
          iconColor={isSaved ? "#000" : "#fff"}
        />
      </View>

      {/* Scrub track along the bottom: a hairline while playing, thickening into
          a draggable bar with a time readout the moment a thumb lands on it. */}
      {hasTrack ? (
        <GestureDetector gesture={scrub}>
          <View style={styles.scrubHit}>
            {scrubbing ? (
              <View style={styles.timeWrap} pointerEvents="none">
                <Text style={styles.timeNow}>{clock(progress * duration)}</Text>
                <Text style={styles.timeTotal}> / {clock(duration)}</Text>
              </View>
            ) : null}
            <Animated.View style={[styles.track, trackStyle, flashStyle]}>
              <View style={[styles.fill, { width: `${progress * 100}%` }]} />
              {scrubbing ? (
                <Animated.View
                  style={[styles.knob, { left: `${progress * 100}%` }]}
                  entering={ZoomIn.duration(140)}
                  exiting={ZoomOut.duration(120)}
                />
              ) : null}
            </Animated.View>
          </View>
        </GestureDetector>
      ) : null}

      {/* Before duration is known (initial load) there's no scrub track yet — show
          a flashing hairline in its place while buffering. */}
      {active && waiting && !hasTrack ? (
        <Animated.View style={[styles.loadingLine, flashStyle]} pointerEvents="none" />
      ) : null}
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
  pausedWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  pausedGlyph: {
    height: 88,
    width: 88,
    borderRadius: 44,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  topScrim: { position: "absolute", top: 0, left: 0, right: 0, height: 150 },
  bottomScrim: { position: "absolute", bottom: 0, left: 0, right: 0, height: 380 },
  topLeft: { position: "absolute", top: 56, left: 16, flexDirection: "row", alignItems: "center", gap: 8 },
  brand: { color: "#fff", fontSize: 15, fontWeight: "700", textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4 },
  thinBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(245,158,11,0.25)", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  thinText: { color: "#fde68a", fontSize: 11, fontWeight: "600" },
  bottomLeft: { position: "absolute", left: 16, right: 84, bottom: 84, gap: 10 },
  hook: { color: "#fff", fontSize: 16, fontWeight: "500", lineHeight: 21, textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { backgroundColor: "rgba(255,255,255,0.18)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  chipText: { color: "rgba(255,255,255,0.95)", fontSize: 11, fontWeight: "600" },
  stats: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: "500" },
  rail: { position: "absolute", right: 12, bottom: "24%", alignItems: "center", gap: 20 },
  railBtn: { alignItems: "center", gap: 4 },
  railIcon: { height: 48, width: 48, borderRadius: 24, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  railLabel: { color: "rgba(255,255,255,0.9)", fontSize: 11, fontWeight: "600" },

  // Lifted clear of the bottom edge: sitting flush, the track fell inside the
  // home-indicator zone, where the system swallows the drag before we see it.
  // The line ends up ~34pt up with a 52pt grab area above it.
  scrubHit: { position: "absolute", left: 0, right: 0, bottom: 24, height: 52, justifyContent: "flex-end", paddingBottom: 10 },
  track: { height: 2.5, backgroundColor: "rgba(255,255,255,0.3)", borderRadius: 2 },
  trackBig: { height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.35)" },
  fill: { height: "100%", backgroundColor: "#fff", borderRadius: 3 },
  loadingLine: { position: "absolute", left: 0, right: 0, bottom: 34, height: 2.5, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.55)" },
  knob: { position: "absolute", top: -5, marginLeft: -7.5, height: 15, width: 15, borderRadius: 8, backgroundColor: "#fff" },
  timeWrap: {
    position: "absolute",
    bottom: 34,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  timeNow: { color: "#fff", fontSize: 14, fontWeight: "700" },
  timeTotal: { color: "rgba(255,255,255,0.6)", fontSize: 14, fontWeight: "600" },
});
