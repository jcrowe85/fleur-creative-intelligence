import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

// Motif load screen: the "m" mark springs in and gently breathes while the app
// mints the guest token and decides onboarding vs feed. White ground matches the
// black mark; swap mobile/assets/motif-logo.png for the official logo any time.
export function AnimatedSplash() {
  const scale = useSharedValue(0.86);
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.quad) });
    scale.value = withSequence(
      withSpring(1, { damping: 12, stiffness: 120 }),
      withRepeat(withTiming(1.05, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, true),
    );
  }, [opacity, scale]);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <View style={styles.root}>
      <Animated.Image source={require("../assets/motif-logo.png")} style={[styles.logo, logoStyle]} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center" },
  logo: { width: 168, height: 120 },
});
