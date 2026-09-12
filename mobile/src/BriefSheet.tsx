import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fetchFramework, type Framework } from "./api";
import type { FeedCard } from "./types";

export function BriefSheet({ card, onClose }: { card: FeedCard | null; onClose: () => void }) {
  const [fw, setFw] = useState<Framework | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <Modal visible={!!card} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.grabberRow}>
            <View style={styles.grabber} />
            <Pressable onPress={onClose} hitSlop={12} style={styles.close}>
              <Ionicons name="close" size={22} color="rgba(255,255,255,0.7)" />
            </Pressable>
          </View>
          <Text style={styles.heading}>Creative brief</Text>
          {card ? <Text style={styles.sub}>{card.brand}</Text> : null}

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.dim}>Generating your brief…</Text>
            </View>
          ) : error ? (
            <Pressable style={styles.center} onPress={() => card && fetchFramework(card.id).then(setFw).catch(() => {})}>
              <Text style={styles.dim}>{error}</Text>
            </Pressable>
          ) : fw ? (
            <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
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
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { height: "86%", backgroundColor: "#111", borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 10 },
  grabberRow: { alignItems: "center", justifyContent: "center", paddingVertical: 6 },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.25)" },
  close: { position: "absolute", right: 0, top: 2 },
  heading: { color: "#fff", fontSize: 20, fontWeight: "800", marginTop: 6 },
  sub: { color: "rgba(255,255,255,0.5)", fontSize: 13, marginTop: 2, marginBottom: 8 },
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
