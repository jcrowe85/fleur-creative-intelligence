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

// Motif load screen: the logo fades + springs in with a soft overshoot, then a
// gentle breathing loop while the app boots. Clean and simple.
export function AnimatedSplash() {
  const scale = useSharedValue(0.82);
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) });
    scale.value = withSequence(
      withSpring(1, { damping: 11, stiffness: 130, mass: 0.9 }),
      withRepeat(withTiming(1.035, { duration: 1500, easing: Easing.inOut(Easing.quad) }), -1, true),
    );
  }, [opacity, scale]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));

  return (
    <View style={styles.root}>
      <Animated.Image source={require("../assets/motif-logo.png")} style={[styles.logo, style]} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center" },
  logo: { width: 200, height: 140 },
});
