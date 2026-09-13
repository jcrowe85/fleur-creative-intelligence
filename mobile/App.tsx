import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { Feed } from "./src/Feed";
import { Saved } from "./src/Saved";
import { BriefSheet } from "./src/BriefSheet";
import { StudyScreen } from "./src/StudyScreen";
import { Onboarding } from "./src/Onboarding";
import { AnimatedSplash } from "./src/AnimatedSplash";
import { fetchContentTypes, fetchSaved, postSave, resetIdentity } from "./src/api";
import type { FeedCard } from "./src/types";

type Route = "loading" | "onboarding" | "feed";

// How far across — or how fast — a drag has to go before it commits.
const COMMIT_RATIO = 0.3;
const COMMIT_VELOCITY = 800;
export const SCREEN_SPRING = { damping: 22, stiffness: 220, mass: 0.7 };

export default function App() {
  const { width } = useWindowDimensions();
  const [route, setRoute] = useState<Route>("loading");

  // Saved list cached at the root, hydrated once and kept current optimistically.
  const [savedCards, setSavedCards] = useState<FeedCard[]>([]);
  const savedIds = useMemo(() => new Set(savedCards.map((c) => c.id)), [savedCards]);
  const [showSaved, setShowSaved] = useState(false);
  const [briefCard, setBriefCard] = useState<FeedCard | null>(null);
  const [briefTab, setBriefTab] = useState<"brief" | "chat">("brief");
  // Section-by-section study is its own full-screen module.
  const [studyCard, setStudyCard] = useState<FeedCard | null>(null);
  // Bumped to re-run the first-run bootstrap after a data reset.
  const [bootKey, setBootKey] = useState(0);

  // The saved screen sits beside the feed rather than on top of it: one shared
  // offset (width = off to the right, 0 = fully open) that a drag can move
  // directly, so the transition follows the finger instead of being a modal.
  const savedX = useSharedValue(width);

  const openSaved = useCallback(() => {
    setShowSaved(true);
    savedX.value = withSpring(0, SCREEN_SPRING);
  }, [savedX]);

  const closeSaved = useCallback(() => {
    setShowSaved(false);
    savedX.value = withSpring(width, SCREEN_SPRING);
  }, [savedX, width]);

  // First run: mint the guest token (implicit) and decide onboarding vs feed by
  // whether the creator has picked content types yet.
  useEffect(() => {
    const started = Date.now();
    const MIN_SPLASH = 1600; // let the logo animation read
    const go = (r: Route) => setTimeout(() => setRoute(r), Math.max(0, MIN_SPLASH - (Date.now() - started)));
    fetchContentTypes()
      .then((types) => go(types.length > 0 ? "feed" : "onboarding"))
      .catch(() => go("feed")); // network hiccup — don't trap them in onboarding
  }, [bootKey]);

  useEffect(() => {
    if (route !== "feed") return;
    fetchSaved()
      .then(setSavedCards)
      .catch(() => {});
  }, [route]);

  const toggleSave = useCallback((card: FeedCard) => {
    setSavedCards((prev) => {
      if (prev.some((c) => c.id === card.id)) {
        postSave(card.id, "dismissed").catch(() => {});
        return prev.filter((c) => c.id !== card.id);
      }
      postSave(card.id, "saved").catch(() => {});
      return [card, ...prev];
    });
  }, []);

  const removeSaved = useCallback((id: string) => {
    setSavedCards((prev) => prev.filter((c) => c.id !== id));
    postSave(id, "dismissed").catch(() => {});
  }, []);

  // Scroll-past skip (Feed only calls this for videos that weren't saved).
  const onSkip = useCallback((id: string) => {
    postSave(id, "dismissed").catch(() => {});
  }, []);

  // Come back as a new creator: drop the guest token, clear what's on screen,
  // and re-run the bootstrap so the next token is minted fresh.
  const resetData = useCallback(async () => {
    await resetIdentity();
    setSavedCards([]);
    setBriefCard(null);
    setShowSaved(false);
    savedX.value = width;
    setRoute("loading");
    setBootKey((k) => k + 1);
  }, [savedX, width]);

  // Drag left anywhere on the feed to pull the saved screen in. Horizontal-only
  // activation keeps the vertical pager intact.
  const openPan = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-20, 20])
    .onUpdate((e) => {
      if (e.translationX > 0) return; // only a leftward pull brings it in
      savedX.value = Math.max(0, width + e.translationX);
    })
    .onEnd((e) => {
      const far = -e.translationX > width * COMMIT_RATIO;
      if (far || e.velocityX < -COMMIT_VELOCITY) {
        savedX.value = withSpring(0, SCREEN_SPRING);
        runOnJS(setShowSaved)(true);
      } else {
        savedX.value = withSpring(width, SCREEN_SPRING);
      }
    });

  const savedStyle = useAnimatedStyle(() => ({ transform: [{ translateX: savedX.value }] }));

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#000" }}>
      <StatusBar style="light" />
      {route === "loading" ? (
        <AnimatedSplash />
      ) : route === "onboarding" ? (
        <Onboarding onDone={() => setRoute("feed")} />
      ) : (
        <>
          <GestureDetector gesture={openPan}>
            <View style={{ flex: 1 }}>
              <Feed
                savedIds={savedIds}
                suspended={showSaved || briefCard !== null || studyCard !== null}
                onToggleSave={toggleSave}
                onSkip={onSkip}
                onOpenBrief={(c) => setStudyCard(c)}
                onOpenChat={(c) => {
                  setBriefTab("chat");
                  setBriefCard(c);
                }}
                onOpenSaved={openSaved}
                onResetData={resetData}
                outerGesture={openPan}
              />
            </View>
          </GestureDetector>

          {/* Kept mounted so it can be dragged partway in and released. */}
          <Animated.View
            style={[StyleSheet.absoluteFill, savedStyle]}
            pointerEvents={showSaved ? "auto" : "none"}
          >
            <Saved cards={savedCards} x={savedX} onClose={closeSaved} onRemove={removeSaved} />
          </Animated.View>

          <BriefSheet card={briefCard} initialTab={briefTab} onClose={() => setBriefCard(null)} />
          {/* Owns its own brief/brainstorm sheet — see the note in StudyScreen. */}
          <StudyScreen card={studyCard} onClose={() => setStudyCard(null)} />
        </>
      )}
    </GestureHandlerRootView>
  );
}
