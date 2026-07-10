import { Component, ReactNode } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// Sits at the very root of the tree (see app/_layout.tsx), above every
// provider — a render-time throw anywhere below it (a bad screen, a bug in
// a context, a malformed response turned into a crash instead of an empty
// state) used to white-screen the entire app with no way back short of
// force-quitting. Deliberately not wired into useLanguage()/useColors() or
// any other app context: those live *inside* this boundary and may be part
// of what's broken, so the fallback UI has to be self-sufficient with its
// own plain styling and hardcoded copy.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("Uncaught render error", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>
            The app hit an unexpected error. Try again — if it keeps happening, force-quitting and
            reopening the app usually clears it.
          </Text>
          <Pressable style={styles.button} onPress={this.handleReset}>
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

// Fixed, self-contained colors — not lib/theme.ts's useColors(), for the
// same reason this whole component avoids app context (see class comment).
const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    backgroundColor: "#0d1524",
  },
  title: { fontSize: 20, fontWeight: "800", color: "#f4f5fb", marginBottom: 12, textAlign: "center" },
  message: { fontSize: 14, color: "#a3aac0", textAlign: "center", lineHeight: 20, marginBottom: 24 },
  button: { backgroundColor: "#7c5cff", paddingVertical: 12, paddingHorizontal: 24, borderRadius: 999 },
  buttonText: { color: "#ffffff", fontSize: 15, fontWeight: "700" },
});
