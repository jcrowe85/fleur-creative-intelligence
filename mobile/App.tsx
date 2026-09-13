import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Feed } from "./src/Feed";
import { Saved } from "./src/Saved";
import { BriefSheet } from "./src/BriefSheet";
import { Onboarding } from "./src/Onboarding";
import { fetchContentTypes, fetchSaved, postSave } from "./src/api";
import type { FeedCard } from "./src/types";

type Route = "loading" | "onboarding" | "feed";

export default function App() {
  const [route, setRoute] = useState<Route>("loading");

  // Saved list cached at the root, hydrated once and kept current optimistically.
  const [savedCards, setSavedCards] = useState<FeedCard[]>([]);
  const savedIds = useMemo(() => new Set(savedCards.map((c) => c.id)), [savedCards]);
  const [showSaved, setShowSaved] = useState(false);
  const [briefCard, setBriefCard] = useState<FeedCard | null>(null);

  // First run: mint the guest token (implicit) and decide onboarding vs feed by
  // whether the creator has picked content types yet.
  useEffect(() => {
    fetchContentTypes()
      .then((types) => setRoute(types.length > 0 ? "feed" : "onboarding"))
      .catch(() => setRoute("feed")); // network hiccup — don't trap them in onboarding
  }, []);

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

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#000" }}>
      <StatusBar style="light" />
      {route === "loading" ? (
        <View style={{ flex: 1, backgroundColor: "#0b0b0c", alignItems: "center", justifyContent: "center", gap: 20 }}>
          <Text style={{ color: "#fff", fontSize: 44, fontWeight: "800", letterSpacing: -1 }}>Motif</Text>
          <ActivityIndicator color="rgba(255,255,255,0.5)" />
        </View>
      ) : route === "onboarding" ? (
        <Onboarding onDone={() => setRoute("feed")} />
      ) : (
        <>
          <Feed
            savedIds={savedIds}
            onToggleSave={toggleSave}
            onOpenBrief={(c) => setBriefCard(c)}
            onOpenSaved={() => setShowSaved(true)}
          />
          <Saved
            visible={showSaved}
            cards={savedCards}
            onClose={() => setShowSaved(false)}
            onRemove={removeSaved}
            onOpenBrief={(c) => setBriefCard(c)}
          />
          <BriefSheet card={briefCard} onClose={() => setBriefCard(null)} />
        </>
      )}
    </GestureHandlerRootView>
  );
}
