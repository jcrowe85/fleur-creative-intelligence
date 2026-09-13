import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
// Gesture handler's own ScrollView — only this one can enter a gesture relation
// with the sheet's pan. With React Native's, simultaneousWithExternalGesture is
// silently ignored and the pan fights the scroll instead of coexisting with it.
import { Gesture, GestureDetector, GestureHandlerRootView, ScrollView } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { ChatView } from "./ChatView";
import { fetchFramework, type Framework } from "./api";
import type { FeedCard } from "./types";

type Tab = "brief" | "chat";

// Gesture handler declares its own ref shape for external gestures; ours are
// plain ScrollView refs, which it only ever reads, never calls.
type ExternalRef = Parameters<ReturnType<typeof Gesture.Pan>["simultaneousWithExternalGesture"]>[0];

// Past this much drag (or a hard flick) the sheet goes rather than springs back.
const DISMISS_PX = 110;
const DISMISS_VELOCITY = 900;
const OPEN_MS = 290;
const CLOSE_MS = 200;
/** Fraction of the screen the sheet covers — also how far it travels. */
const SHEET_RATIO = 0.86;

export function BriefSheet({
  card,
  initialTab = "brief",
  onClose,
}: {
  card: FeedCard | null;
  /** Which tab to land on — the rail's Brainstorm button opens straight to chat.
   *  Section-by-section study is its own full-screen module (StudyScreen). */
  initialTab?: Tab;
  onClose: () => void;
}) {
  const { height } = useWindowDimensions();
  const sheetH = height * SHEET_RATIO;
  const [fw, setFw] = useState<Framework | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);

  // The sheet fades in over the dimmed backdrop rather than sliding up, so the
  // native modal animation is off and this drives both.
  const appear = useSharedValue(0);
  const ty = useSharedValue(0);
  // The body drags the sheet only when it's already at the top. This is React
  // state rather than a shared value because it switches the pan off outright:
  // a disabled gesture can't compete with the scroll view for the touch, which
  // a guard inside onUpdate never achieved — the pan still activated and ate it.
  const [atTop, setAtTop] = useState(true);
  const atTopRef = useRef(true);
  const onBodyScroll = useCallback((y: number) => {
    const top = y <= 0;
    if (top !== atTopRef.current) {
      atTopRef.current = top;
      setAtTop(top);
    }
  }, []);
  const briefScrollRef = useRef<ScrollView>(null);
  const chatScrollRef = useRef<ScrollView>(null);

  const finish = useCallback(() => onClose(), [onClose]);

  // Fade out first, then unmount — otherwise clearing the card kills the modal
  // mid-animation and the sheet just vanishes.
  const dismiss = useCallback(() => {
    appear.value = withTiming(0, { duration: CLOSE_MS, easing: Easing.in(Easing.cubic) }, (done) => {
      if (done) runOnJS(finish)();
    });
  }, [appear, finish]);

  // A fresh card means a fresh sheet: reset the tab, the drag, and fade in.
  useEffect(() => {
    if (card) {
      setTab(initialTab);
      ty.value = 0;
      atTopRef.current = true;
      setAtTop(true);
      appear.value = withTiming(1, { duration: OPEN_MS, easing: Easing.out(Easing.cubic) });
    } else {
      appear.value = 0;
    }
  }, [card, initialTab, ty, appear]);

  useEffect(() => {
    if (!card) {
      setFw(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetchFramework(card.id)
      .then(setFw)
      .catch(() => setError("Couldn't load the brief — tap to retry."))
      .finally(() => setLoading(false));
  }, [card]);

  // `anywhere` = the header, which has nothing to scroll and so always drags.
  // The body's pan exists only while the list is at the top; below that it is
  // disabled and every touch belongs to the scroll view.
  const makePan = (anywhere: boolean) =>
    Gesture.Pan()
      .enabled(anywhere || atTop)
      // Downward only, so an upward swipe always belongs to the list.
      .activeOffsetY([12, 10000])
      .simultaneousWithExternalGesture(
        briefScrollRef as unknown as ExternalRef,
        chatScrollRef as unknown as ExternalRef,
      )
      .onUpdate((e) => {
        ty.value = Math.max(0, e.translationY);
      })
      .onEnd((e) => {
        if (ty.value > DISMISS_PX || e.velocityY > DISMISS_VELOCITY) {
          appear.value = withTiming(0, { duration: CLOSE_MS, easing: Easing.in(Easing.cubic) }, (done) => {
            if (done) runOnJS(finish)();
          });
        } else {
          ty.value = withSpring(0, { damping: 20, stiffness: 200 });
        }
      });

  const headerPan = makePan(true);
  const bodyPan = makePan(false);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: appear.value }));
  // The sheet slides up from the bottom; only the backdrop fades. The sheet
  // keeps full opacity throughout, so it reads as a surface arriving rather
  // than something materialising in place.
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - appear.value) * sheetH + ty.value }],
  }));

  return (
    <Modal visible={!!card} animationType="none" transparent onRequestClose={dismiss}>
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} />
        </Animated.View>

        <GestureHandlerRootView style={styles.sheetLayer} pointerEvents="box-none">
          <Animated.View style={[styles.sheet, sheetStyle]}>
            <GestureDetector gesture={headerPan}>
              <View>
                <View style={styles.grabberRow}>
                  <View style={styles.grabber} />
                  <Pressable onPress={dismiss} hitSlop={12} style={styles.close}>
                    <Ionicons name="close" size={22} color="rgba(255,255,255,0.7)" />
                  </Pressable>
                </View>

                <View style={styles.tabs}>
                  <Pressable onPress={() => setTab("brief")} style={[styles.tab, tab === "brief" && styles.tabOn]}>
                    <Text style={[styles.tabText, tab === "brief" && styles.tabTextOn]}>Brief</Text>
                  </Pressable>
                  <Pressable onPress={() => setTab("chat")} style={[styles.tab, tab === "chat" && styles.tabOn]}>
                    <Text style={[styles.tabText, tab === "chat" && styles.tabTextOn]}>Brainstorm</Text>
                  </Pressable>
                </View>
                {card ? <Text style={styles.sub}>{card.brand}</Text> : null}
              </View>
            </GestureDetector>

            <GestureDetector gesture={bodyPan}>
              <View style={{ flex: 1 }}>
                {tab === "chat" ? (
                  // Keyed by card so switching videos starts a fresh conversation.
                  card ? (
                    <ChatView
                      key={card.id}
                      assetId={card.id}
                      scrollRef={chatScrollRef}
                      onScrollY={onBodyScroll}
                    />
                  ) : null
                ) : loading ? (
                  <View style={styles.center}>
                    <ActivityIndicator color="#fff" />
                    <Text style={styles.dim}>Generating your brief…</Text>
                  </View>
                ) : error ? (
                  <Pressable style={styles.center} onPress={() => card && fetchFramework(card.id).then(setFw).catch(() => {})}>
                    <Text style={styles.dim}>{error}</Text>
                  </Pressable>
                ) : fw ? (
                  <ScrollView
                    ref={briefScrollRef}
                    onScroll={(e) => onBodyScroll(e.nativeEvent.contentOffset.y)}
                    scrollEventThrottle={16}
                    contentContainerStyle={{ paddingBottom: 40 }}
                    showsVerticalScrollIndicator={false}
                  >
                    <Section title="Why it works">
                      <Text style={styles.body}>{fw.whyItWorks}</Text>
                    </Section>

                    <Section title="The structure">
                      {fw.beats.map((b, i) => (
                        <View key={i} style={styles.beat}>
                          <Text style={styles.beatTime}>{b.time}</Text>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.beatJob}>{b.job}</Text>
                            <Text style={styles.beatDetail}>{b.detail}</Text>
                          </View>
                        </View>
                      ))}
                    </Section>

                    <Section title="Hook options">
                      {fw.hookOptions.map((h, i) => (
                        <Text key={i} style={styles.bullet}>
                          • {h}
                        </Text>
                      ))}
                    </Section>

                    <Section title="Fleur angle">
                      <Text style={styles.body}>{fw.fleurAngle}</Text>
                    </Section>

                    <Section title="Your canvas">
                      <Text style={styles.body}>{fw.yourCanvas}</Text>
                    </Section>

                    <Section title="Compliance">
                      {fw.compliance.map((c, i) => (
                        <Text key={i} style={styles.bulletWarn}>
                          • {c}
                        </Text>
                      ))}
                    </Section>
                  </ScrollView>
                ) : null}
              </View>
            </GestureDetector>
          </Animated.View>
        </GestureHandlerRootView>
      </View>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)" },
  sheetLayer: { flex: 1, justifyContent: "flex-end" },
  sheet: { height: "86%", backgroundColor: "#111", borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12 },
  grabberRow: { alignItems: "center", justifyContent: "center", paddingVertical: 6 },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.25)" },
  close: { position: "absolute", right: 0, top: 2 },
  tabs: { flexDirection: "row", gap: 4, alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 999, padding: 4, marginTop: 6 },
  tab: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 5 },
  tabOn: { backgroundColor: "#fff" },
  tabText: { color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: "600" },
  tabTextOn: { color: "#000" },
  sub: { color: "rgba(255,255,255,0.5)", fontSize: 13, marginTop: 8, marginBottom: 4 },
  center: { alignItems: "center", justifyContent: "center", paddingVertical: 60, gap: 12 },
  dim: { color: "rgba(255,255,255,0.6)", fontSize: 14 },
  section: { marginTop: 18 },
  sectionTitle: { color: "rgba(255,255,255,0.5)", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  body: { color: "rgba(255,255,255,0.92)", fontSize: 15, lineHeight: 22 },
  beat: { flexDirection: "row", gap: 12, marginBottom: 12 },
  beatTime: { color: "#a5b4fc", fontSize: 13, fontWeight: "700", width: 56 },
  beatJob: { color: "#fff", fontSize: 14, fontWeight: "600" },
  beatDetail: { color: "rgba(255,255,255,0.7)", fontSize: 13, lineHeight: 19, marginTop: 2 },
  bullet: { color: "rgba(255,255,255,0.92)", fontSize: 15, lineHeight: 24 },
  bulletWarn: { color: "#fca5a5", fontSize: 14, lineHeight: 22 },
});
