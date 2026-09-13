import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from "react-native-reanimated";

// Motif load screen: black ground, white wordmark, no spinner. Each letter
// rises and settles on a short stagger, a hairline draws underneath, then the
// whole mark breathes slowly for as long as the app is still fetching — so the
// wait reads as one continuous animation instead of logo-then-spinner.
const WORD = ["m", "o", "t", "i", "f"];
const STAGGER = 90; // ms between letters
const SETTLED = WORD.length * STAGGER + 180; // last letter has landed

export function AnimatedSplash() {
  const rule = useSharedValue(0);
  const breathe = useSharedValue(0);

  useEffect(() => {
    rule.value = withDelay(
      SETTLED,
      withTiming(1, { duration: 620, easing: Easing.out(Easing.cubic) }),
    );
    breathe.value = withDelay(
      SETTLED + 220,
      withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.quad) }), -1, true),
    );
  }, [breathe, rule]);

  // Breathing rides on the whole lockup so the letters stay in register.
  const lockup = useAnimatedStyle(() => ({
    opacity: 0.82 + breathe.value * 0.18,
    transform: [{ scale: 1 + breathe.value * 0.012 }],
  }));

  // The rule wipes out from the centre as it fades up.
  const ruleStyle = useAnimatedStyle(() => ({
    opacity: rule.value,
    transform: [{ scaleX: rule.value }],
  }));

  return (
    <View style={styles.root}>
      <Animated.View style={lockup}>
        <View style={styles.word}>
          {WORD.map((char, i) => (
            <Letter key={`${char}${i}`} char={char} index={i} />
          ))}
        </View>
        <Animated.View style={[styles.rule, ruleStyle]} />
      </Animated.View>
    </View>
  );
}

function Letter({ char, index }: { char: string; index: number }) {
  const p = useSharedValue(0);

  useEffect(() => {
    // Spring overshoot gives each letter a small lift past its resting line.
    p.value = withDelay(index * STAGGER, withSpring(1, { damping: 14, stiffness: 120, mass: 0.8 }));
  }, [index, p]);

  const style = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ translateY: (1 - p.value) * 18 }],
  }));

  return <Animated.Text style={[styles.letter, style]}>{char}</Animated.Text>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000000", alignItems: "center", justifyContent: "center" },
  word: { flexDirection: "row", alignItems: "flex-end" },
  letter: {
    color: "#ffffff",
    fontSize: 64,
    lineHeight: 74,
    fontWeight: "700",
    letterSpacing: -2.5,
  },
  rule: { alignSelf: "center", marginTop: 16, width: 140, height: 2, borderRadius: 1, backgroundColor: "#ffffff" },
});
