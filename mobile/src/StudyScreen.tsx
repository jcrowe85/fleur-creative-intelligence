import { useEffect, useMemo, useState } from "react";
import { useEvent } from "expo";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Directions, Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutDown,
  LinearTransition,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useVideoPlayer, VideoView, type VideoThumbnail } from "expo-video";
import { BriefSheet } from "./BriefSheet";
import { fetchFramework, type Beat } from "./api";
import type { FeedCard } from "./types";

// expo-video polls rather than interrupts, so a section loop overshoots by up
// to one interval. 50ms is under the threshold where a repeat looks sloppy.
const LOOP_POLL = 0.05;
// The panel resizes itself as sections change length and as the direction opens,
// so it animates its own layout rather than snapping between heights.
const APanel = Animated.createAnimatedComponent(BlurView);
const ATile = Animated.createAnimatedComponent(Pressable);
// Track tiles are sized by how long the section runs, like clips on a timeline.
const PX_PER_SEC = 7;
const TILE_MIN = 52;
const TILE_MAX = 132;

/**
 * Full-screen study of one reference clip, section by section.
 *
 * The video plays edge to edge and loops the current section; the direction sits
 * over it, with no panel in the way. Along the bottom each section is a clip on
 * a track — real frames pulled from the video, sized by duration — so a creator
 * can see what's coming and jump around. These are the same boundaries they'd
 * film against, since a script gets shot in pieces and stitched.
 */
export function StudyScreen({ card, onClose }: { card: FeedCard | null; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const [beats, setBeats] = useState<Beat[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [thumbs, setThumbs] = useState<VideoThumbnail[] | null>(null);
  // Chrome off entirely — for watching the clip clean.
  const [hidden, setHidden] = useState(false);
  // The title is the resting state; the direction is there when asked for.
  const [expanded, setExpanded] = useState(false);

  useEffect(() => setExpanded(false), [index]);

  // The brief/brainstorm sheet belongs to this screen: a modal presented from
  // behind an open modal doesn't reliably come to the front on iOS.
  const [sheetCard, setSheetCard] = useState<FeedCard | null>(null);
  const [sheetTab, setSheetTab] = useState<"brief" | "chat">("brief");
  const suspended = sheetCard !== null;

  const player = useVideoPlayer(card?.mediaUrl ? { uri: card.mediaUrl } : null, (p) => {
    p.loop = false; // the section is looped by hand; whole-clip looping runs past it
    p.timeUpdateEventInterval = LOOP_POLL;
    p.muted = false; // the words are most of the value
  });

  const { currentTime } = useEvent(player, "timeUpdate", {
    currentTime: player.currentTime,
    bufferedPosition: player.bufferedPosition,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
  });
  const { status } = useEvent(player, "statusChange", { status: player.status });
  const { isPlaying } = useEvent(player, "playingChange", { isPlaying: player.playing });

  // Fresh card: reset and fetch its sections. The first open of a clip waits on
  // generation; every open after is instant. `attempt` re-runs it on a retry.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setBeats(null);
    setThumbs(null);
    setIndex(0);
    setError(null);
    if (!card) return;
    let cancelled = false;
    fetchFramework(card.id)
      .then((fw) => !cancelled && setBeats(fw.beats ?? []))
      .catch(() => !cancelled && setError("Tap to try again."));
    return () => {
      cancelled = true;
    };
  }, [card, attempt]);

  const beat: Beat | undefined = beats?.[index];
  const start = beat?.startSec ?? 0;
  const end = beat?.endSec ?? 0;

  // Land on the section when it changes — and hold still while a sheet is over it.
  useEffect(() => {
    if (!beat) return;
    if (suspended) {
      player.pause();
      return;
    }
    player.currentTime = start;
    player.play();
  }, [beat, start, suspended, player]);

  // No A-B loop exists in expo-video, so the window is held by hand.
  useEffect(() => {
    if (!beat || suspended || end <= start) return;
    if (currentTime >= end || currentTime < start - 0.3) player.currentTime = start;
  }, [currentTime, beat, start, end, suspended, player]);

  // One real frame per section for the track. Needs a loaded source, and it's
  // cheap enough to do once per clip.
  useEffect(() => {
    if (!beats?.length || status !== "readyToPlay" || thumbs) return;
    let cancelled = false;
    const times = beats.map((b) => Math.min(b.startSec + 0.2, Math.max(0, b.endSec - 0.05)));
    player
      .generateThumbnailsAsync(times, { maxWidth: 180, maxHeight: 180 })
      .then((t) => !cancelled && setThumbs(t))
      .catch(() => {
        /* the poster frame stands in */
      });
    return () => {
      cancelled = true;
    };
  }, [beats, status, thumbs, player]);

  const go = (next: number) => {
    if (!beats?.length) return;
    const clamped = Math.min(beats.length - 1, Math.max(0, next));
    if (clamped !== index) Haptics.selectionAsync().catch(() => {});
    setIndex(clamped);
  };

  const openSheet = (tab: "brief" | "chat") => {
    setSheetTab(tab);
    setSheetCard(card);
  };

  const flings = useMemo(
    () =>
      Gesture.Race(
        Gesture.Fling().direction(Directions.DOWN).runOnJS(true).onEnd(() => onClose()),
        Gesture.Fling()
          .direction(Directions.LEFT)
          .runOnJS(true)
          .onEnd(() => setIndex((i) => (beats ? Math.min(beats.length - 1, i + 1) : i))),
        Gesture.Fling()
          .direction(Directions.RIGHT)
          .runOnJS(true)
          .onEnd(() => setIndex((i) => Math.max(0, i - 1))),
      ),
    [beats, onClose],
  );

  // Tap-to-pause is scoped to the bare video area, so tapping the panel to read
  // more (or the track to jump) doesn't also stop playback.
  const tapPlay = useMemo(
    () =>
      Gesture.Tap()
        .runOnJS(true)
        .onEnd(() => (player.playing ? player.pause() : player.play())),
    [player],
  );

  const span = Math.max(0.001, end - start);
  const progress = Math.min(1, Math.max(0, (currentTime - start) / span));
  const last = !!beats && index === beats.length - 1;

  return (
    <Modal visible={!!card} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#000" }}>
        <GestureDetector gesture={flings}>
          <View style={{ width, height }}>
            {card?.mediaUrl ? (
              <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
            ) : null}

            <LinearGradient colors={["rgba(0,0,0,0.75)", "transparent"]} style={styles.topScrim} pointerEvents="none" />
            {/* Much lighter than before: the frosted panel carries legibility now,
                so this only has to keep the track readable. */}
            <LinearGradient
              colors={["transparent", "rgba(0,0,0,0.18)", "rgba(0,0,0,0.62)"]}
              locations={[0, 0.55, 1]}
              style={styles.bottomScrim}
              pointerEvents="none"
            />

            <GestureDetector gesture={tapPlay}>
              <View style={[styles.tapArea, hidden && styles.tapAreaWide]} />
            </GestureDetector>

            {/* top bar */}
            <View style={styles.top}>
              <Pressable onPress={onClose} hitSlop={12} style={styles.iconBtn}>
                <Ionicons name="chevron-down" size={24} color="#fff" />
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={styles.brand} numberOfLines={1}>
                  {card?.brand ?? ""}
                </Text>
                {beats?.length ? (
                  <Text style={styles.counter}>
                    Section {index + 1} of {beats.length} · {beat?.time}
                  </Text>
                ) : null}
              </View>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  setHidden((h) => !h);
                }}
                hitSlop={10}
                style={styles.iconPill}
              >
                <Ionicons name={hidden ? "eye-outline" : "eye-off-outline"} size={16} color="#fff" />
              </Pressable>
              <Pressable onPress={() => openSheet("brief")} hitSlop={8} style={styles.pill}>
                <Ionicons name="sparkles" size={13} color="#fff" />
                <Text style={styles.pillText}>Brief</Text>
              </Pressable>
              <Pressable onPress={() => openSheet("chat")} hitSlop={8} style={styles.pill}>
                <Ionicons name="chatbubble-ellipses-outline" size={13} color="#fff" />
                <Text style={styles.pillText}>Ask</Text>
              </Pressable>
            </View>

            {!isPlaying && beat && !suspended ? (
              <View style={styles.pausedWrap} pointerEvents="none">
                <View style={styles.pausedGlyph}>
                  <Ionicons name="play" size={40} color="#fff" style={{ marginLeft: 4 }} />
                </View>
              </View>
            ) : null}

            {/* Direction sits on frosted glass rather than shadowed text over a
                dark wash: the footage stays visible and moving behind it, and the
                type never has to fight whatever is on screen. Rendered after the
                video, which is what keeps the blur sampling live content. */}
            {!hidden ? (
              <Animated.View
                style={styles.overlay}
                pointerEvents="box-none"
                entering={FadeInDown.duration(260)}
                exiting={FadeOutDown.duration(180)}
              >
                <APanel
                  intensity={56}
                  tint="systemThinMaterialDark"
                  style={styles.panel}
                  layout={LinearTransition.duration(240)}
                >
                  {error ? (
                    <Pressable onPress={() => setAttempt((a) => a + 1)}>
                      <Text style={styles.job}>Couldn&rsquo;t map this one</Text>
                      <Text style={styles.detail}>{error}</Text>
                    </Pressable>
                  ) : !beats ? (
                    <>
                      <Text style={styles.job}>Working out your shot list…</Text>
                      <Text style={styles.detail}>
                        Splitting this into the shots you&rsquo;d film one at a time, and what each one has to do.
                        Takes a minute the first time — instant whenever you come back.
                      </Text>
                    </>
                  ) : beat ? (
                    // Keyed by section so the wording crossfades and lifts when
                    // you move, instead of swapping in place.
                    <Pressable key={index} onPress={() => setExpanded((e) => !e)}>
                      <Animated.View style={styles.panelHead} entering={FadeInDown.duration(240)}>
                        <Text style={styles.job}>{beat.job}</Text>
                        <Ionicons
                          name={expanded ? "chevron-down" : "chevron-up"}
                          size={18}
                          color="rgba(255,255,255,0.55)"
                          style={{ marginTop: 4 }}
                        />
                      </Animated.View>

                      {expanded ? (
                        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(120)}>
                          <ScrollView style={{ maxHeight: height * 0.26 }} showsVerticalScrollIndicator={false}>
                            <Text style={styles.detail}>{beat.detail}</Text>
                            {beat.says ? (
                              <View style={styles.quote}>
                                <View style={styles.quoteRule} />
                                <Text style={styles.says}>{beat.says}</Text>
                              </View>
                            ) : null}
                          </ScrollView>
                        </Animated.View>
                      ) : (
                        <Animated.Text style={styles.more} entering={FadeIn.duration(200)}>
                          Tap for the direction
                        </Animated.Text>
                      )}
                    </Pressable>
                  ) : null}
                </APanel>
              </Animated.View>
            ) : null}

            {/* the track: one clip per section, sized by how long it runs */}
            {beats?.length && !hidden ? (
              <Animated.View
                style={styles.trackWrap}
                pointerEvents="box-none"
                entering={FadeInDown.duration(280)}
                exiting={FadeOutDown.duration(180)}
              >
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.track}>
                  {beats.map((b, i) => {
                    const w = Math.max(TILE_MIN, Math.min(TILE_MAX, (b.endSec - b.startSec) * PX_PER_SEC));
                    const on = i === index;
                    const thumb = thumbs?.[i];
                    return (
                      <ATile
                        key={`${b.time}-${i}`}
                        onPress={() => go(i)}
                        style={[styles.tile, { width: w }, on && styles.tileOn]}
                        layout={LinearTransition.duration(240)}
                        entering={FadeIn.delay(Math.min(i, 8) * 40).duration(260)}
                      >
                        {thumb ? (
                          <Image source={thumb} style={StyleSheet.absoluteFill} contentFit="cover" />
                        ) : card?.thumbUrl ? (
                          <Image source={{ uri: card.thumbUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
                        ) : null}
                        <View style={[styles.tileVeil, on && { backgroundColor: "transparent" }]} />
                        <Text style={styles.tileNum}>{i + 1}</Text>
                        {on ? (
                          <View style={styles.tileProgress}>
                            <View style={[styles.tileProgressFill, { width: `${progress * 100}%` }]} />
                          </View>
                        ) : null}
                      </ATile>
                    );
                  })}
                </ScrollView>

                <View style={styles.nav}>
                  <Pressable
                    onPress={() => go(index - 1)}
                    disabled={index === 0}
                    style={[styles.navBtn, index === 0 && styles.off]}
                    hitSlop={8}
                  >
                    <Ionicons name="chevron-back" size={18} color="#fff" />
                    <Text style={styles.navBtnText}>Back</Text>
                  </Pressable>
                  <Text style={styles.hint}>swipe · tap to pause</Text>
                  <Pressable onPress={() => go(index + 1)} disabled={last} style={[styles.next, last && styles.off]} hitSlop={8}>
                    <Text style={styles.nextText}>{last ? "Last section" : "Next"}</Text>
                    <Ionicons name="chevron-forward" size={18} color="#000" />
                  </Pressable>
                </View>
              </Animated.View>
            ) : null}
          </View>
        </GestureDetector>

        <BriefSheet card={sheetCard} initialTab={sheetTab} onClose={() => setSheetCard(null)} />
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  topScrim: { position: "absolute", top: 0, left: 0, right: 0, height: 170 },
  bottomScrim: { position: "absolute", left: 0, right: 0, bottom: 0, height: 420 },

  top: { position: "absolute", top: 54, left: 12, right: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  iconBtn: { height: 36, width: 36, borderRadius: 18, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  brand: { color: "#fff", fontSize: 15, fontWeight: "700" },
  counter: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "600", marginTop: 1 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.16)",
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  pillText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  iconPill: {
    height: 32,
    width: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },

  // Tap-to-pause only covers the bare video, never the panel or the track.
  tapArea: { position: "absolute", left: 0, right: 0, top: 110, bottom: 300 },
  tapAreaWide: { bottom: 60 },

  pausedWrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  pausedGlyph: { height: 80, width: 80, borderRadius: 40, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },

  overlay: { position: "absolute", left: 14, right: 14, bottom: 186 },
  // The panel is the legibility device — no text shadows anywhere inside it.
  panel: {
    borderRadius: 24,
    overflow: "hidden",
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.18)",
  },
  loading: { color: "rgba(255,255,255,0.8)", fontSize: 15 },
  panelHead: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  job: { flex: 1, color: "#fff", fontSize: 22, fontWeight: "700", lineHeight: 28, letterSpacing: -0.3 },
  more: { color: "rgba(255,255,255,0.5)", fontSize: 12, fontWeight: "600", marginTop: 6 },
  detail: { color: "rgba(255,255,255,0.88)", fontSize: 15, lineHeight: 22 },
  // Quoted speech gets a rule instead of italics — it reads as a different
  // voice without weakening the type.
  quote: { flexDirection: "row", gap: 10, marginTop: 12 },
  quoteRule: { width: 2, borderRadius: 1, backgroundColor: "rgba(255,255,255,0.35)" },
  says: { flex: 1, color: "rgba(255,255,255,0.74)", fontSize: 14, lineHeight: 20 },

  trackWrap: { position: "absolute", left: 0, right: 0, bottom: 34, gap: 12 },
  track: { paddingHorizontal: 16, gap: 6, alignItems: "center" },
  tile: { height: 64, borderRadius: 8, overflow: "hidden", backgroundColor: "#1a1a1a", borderWidth: 2, borderColor: "transparent" },
  tileOn: { borderColor: "#fff", height: 76 },
  tileVeil: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)" },
  tileNum: { position: "absolute", top: 4, left: 6, color: "#fff", fontSize: 11, fontWeight: "800", textShadowColor: "rgba(0,0,0,0.8)", textShadowRadius: 3 },
  tileProgress: { position: "absolute", left: 0, right: 0, bottom: 0, height: 3, backgroundColor: "rgba(255,255,255,0.3)" },
  tileProgressFill: { height: "100%", backgroundColor: "#fff" },

  nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  navBtn: { flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: 8, paddingRight: 8 },
  navBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  hint: { color: "rgba(255,255,255,0.4)", fontSize: 11, fontWeight: "600" },
  next: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#fff", borderRadius: 999, paddingLeft: 16, paddingRight: 12, height: 38 },
  nextText: { color: "#000", fontSize: 14, fontWeight: "700" },
  off: { opacity: 0.4 },
});
