import { useCallback, useEffect, useMemo, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Feed } from "./src/Feed";
import { Saved } from "./src/Saved";
import { BriefSheet } from "./src/BriefSheet";
import { fetchSaved, postSave } from "./src/api";
import type { FeedCard } from "./src/types";

export default function App() {
  // Saved list cached at the root, hydrated once and kept current optimistically —
  // so opening it is instant and newly-saved items appear immediately.
  const [savedCards, setSavedCards] = useState<FeedCard[]>([]);
  const savedIds = useMemo(() => new Set(savedCards.map((c) => c.id)), [savedCards]);
  const [showSaved, setShowSaved] = useState(false);
  const [briefCard, setBriefCard] = useState<FeedCard | null>(null);

  useEffect(() => {
    fetchSaved()
      .then(setSavedCards)
      .catch(() => {});
  }, []);

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
    </GestureHandlerRootView>
  );
}
