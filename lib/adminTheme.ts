// Deliberately not lib/theme.ts's useColors()/light-dark palette — an admin
// moderation console reads content other users flagged as abusive or
// broken; keeping it visually distinct (dark, fixed, slightly clinical)
// from the rest of the app is the point, so there's never a moment of
// confusing it for a normal in-app screen, on either light or dark system
// theme. Shared by every screen under app/admin/ (index, support/[userId])
// so they stay visually identical without each hand-rolling its own copy.
export const C = {
  bg: "#0a0c10",
  surface: "#14171d",
  border: "#262b34",
  text: "#e8eaed",
  textMuted: "#8b92a0",
  accent: "#4d8cff",
  red: "#ff5c5c",
  green: "#3ecf8e",
  yellow: "#e0a400",
};
