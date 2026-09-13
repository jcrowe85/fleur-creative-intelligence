import { useEffect } from "react";
import { Image, StyleSheet, View } from "react-native";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from "react-native-reanimated";

// Motif load screen. The m mark is rendered in "chrome" (a metallic gradient) with
// colored light bars sweeping across it (Star-Wars-intro vibe), masked to the logo
// so the lights play *on* the letterform. Uses mobile/assets/motif-logo.png as the
// mask — for the lights to be m-shaped it must be a TRANSPARENT png (m opaque,
// background transparent). With an opaque logo the effect fills a rounded panel.

const BOX_W = 260;
const BOX_H = 180;

export function AnimatedSplash() {
  const scale = useSharedValue(0.9);
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 500, easing: Easing.out(Easing.quad) });
    scale.value = withSpring(1, { damping: 13, stiffness: 120 });
  }, [opacity, scale]);

  const wrap = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));

  return (
    <View style={styles.root}>
      <Animated.View style={[{ width: BOX_W, height: BOX_H }, wrap]}>
        <MaskedView
          style={StyleSheet.absoluteFill}
          maskElement={
            <View style={styles.maskWrap}>
              <Image source={require("../assets/motif-logo.png")} style={styles.logo} resizeMode="contain" />
            </View>
          }
        >
          {/* chrome base */}
          <LinearGradient
            colors={["#8b9096", "#ffffff", "#c2c7cc", "#f4f6f8", "#9aa0a6", "#e8eaed"]}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          {/* colored lights sweeping over the chrome */}
          <LightBand color="rgba(255,45,149,0.9)" duration={1500} delay={0} />
          <LightBand color="rgba(37,230,255,0.9)" duration={1900} delay={500} />
          <LightBand color="rgba(255,210,74,0.9)" duration={1250} delay={950} />
        </MaskedView>
      </Animated.View>
    </View>
  );
}

function LightBand({ color, duration, delay }: { color: string; duration: number; delay: number }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.quad) }), -1, false));
  }, [p, delay, duration]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: -BOX_W + p.value * (BOX_W * 2) }, { rotate: "18deg" }],
  }));
  return (
    <Animated.View style={[styles.band, style]}>
      <LinearGradient colors={["transparent", color, "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1 }} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#050506", alignItems: "center", justifyContent: "center" },
  maskWrap: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "transparent" },
  logo: { width: BOX_W, height: BOX_H },
  band: { position: "absolute", top: -BOX_H * 0.5, height: BOX_H * 2, width: BOX_W * 0.45 },
});
