/** Light interaction feedback — Vibration API when available. */
export function haptic(kind: "tap" | "success" | "warn" = "tap") {
  if (typeof navigator === "undefined" || !navigator.vibrate) return;
  const pattern =
    kind === "success" ? [12, 30, 18] : kind === "warn" ? [28, 40, 28] : [10];
  try {
    navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}
