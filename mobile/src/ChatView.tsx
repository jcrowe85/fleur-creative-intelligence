import { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
// Same reason as the sheet: the pan can only relate to gesture-handler's own
// scroll view, so drag-to-dismiss and scrolling stop fighting each other.
import { ScrollView } from "react-native-gesture-handler";
import { Ionicons } from "@expo/vector-icons";
import { streamChat, type ChatMsg } from "./api";

// Openers that match how a creator actually starts: they want the thing made,
// re-angled, or cut down — not a conversation about the video.
const SUGGESTIONS = [
  "Write me a full script",
  "Suggest a different setting",
  "Make it 15 seconds",
  "Re-angle for postpartum",
];

export function ChatView({
  assetId,
  scrollRef: externalScrollRef,
  onScrollY,
}: {
  assetId: string;
  /** The sheet needs this to run drag-to-dismiss alongside the message list. */
  scrollRef?: React.RefObject<ScrollView | null>;
  onScrollY?: (y: number) => void;
}) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const localRef = useRef<ScrollView>(null);
  const scrollRef = externalScrollRef ?? localRef;

  const send = async (text: string) => {
    const body = text.trim();
    if (!body || busy) return;

    const next: ChatMsg[] = [...msgs, { role: "user", content: body }];
    // The empty assistant turn is the one the stream fills in.
    setMsgs([...next, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);

    let acc = "";
    try {
      await streamChat(assetId, next, (chunk) => {
        acc += chunk;
        setMsgs((m) => {
          const copy = m.slice();
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
      });
    } catch {
      setMsgs((m) => {
        const copy = m.slice();
        copy[copy.length - 1] = { role: "assistant", content: "Sorry — I hit an error. Try again." };
        return copy;
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={12}
    >
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 8, gap: 8 }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        onScroll={(e) => onScrollY?.(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {msgs.length === 0 ? (
          <View style={{ gap: 12, paddingVertical: 8 }}>
            <Text style={styles.primer}>
              Ask about remaking this for Fleur — a script, a different setting, a re-angle, a shorter cut.
            </Text>
            <View style={styles.chips}>
              {SUGGESTIONS.map((s) => (
                <Pressable key={s} onPress={() => send(s)} style={styles.chip}>
                  <Text style={styles.chipText}>{s}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          msgs.map((m, i) => {
            const sent = m.role === "user";
            const waiting = !sent && !m.content && busy;
            return (
              <View key={i} style={sent ? styles.rowRight : styles.rowLeft}>
                <View style={[styles.bubble, sent ? styles.sent : styles.received]}>
                  <Text style={styles.bubbleText}>{waiting ? "…" : m.content}</Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Ask anything about this idea…"
          placeholderTextColor="rgba(255,255,255,0.4)"
          style={styles.input}
          multiline
          onSubmitEditing={() => send(input)}
        />
        <Pressable
          onPress={() => send(input)}
          disabled={busy || !input.trim()}
          style={[styles.send, busy || !input.trim() ? styles.sendOff : null]}
          hitSlop={8}
        >
          <Ionicons name="arrow-up" size={18} color={busy || !input.trim() ? "rgba(255,255,255,0.4)" : "#fff"} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  primer: { color: "rgba(255,255,255,0.5)", fontSize: 13, lineHeight: 19 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { color: "rgba(255,255,255,0.85)", fontSize: 12 },
  rowRight: { alignItems: "flex-end" },
  rowLeft: { alignItems: "flex-start" },
  bubble: { maxWidth: "82%", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9 },
  sent: { backgroundColor: "#0A84FF", borderBottomRightRadius: 6 },
  received: { backgroundColor: "#262629", borderBottomLeftRadius: 6 },
  bubbleText: { color: "#fff", fontSize: 14, lineHeight: 19 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 22,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 8,
  },
  input: { flex: 1, color: "#fff", fontSize: 16, maxHeight: 120, paddingTop: 6, paddingBottom: 6 },
  send: {
    height: 32,
    width: 32,
    borderRadius: 16,
    backgroundColor: "#0A84FF",
    alignItems: "center",
    justifyContent: "center",
  },
  sendOff: { backgroundColor: "rgba(255,255,255,0.2)" },
});
