import { createContext, useContext, useEffect, useState, PropsWithChildren } from "react";
import NetInfo from "@react-native-community/netinfo";

interface NetworkContextValue {
  // True only once NetInfo has actually reported the device as disconnected
  // (isConnected === false) — not merely "unknown yet" (null on startup, or
  // isInternetReachable still resolving), which would otherwise flash an
  // "offline" banner on every cold launch before the first real reading
  // comes in.
  isOffline: boolean;
}

const NetworkContext = createContext<NetworkContextValue>({ isOffline: false });

export function NetworkProvider({ children }: PropsWithChildren) {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    return NetInfo.addEventListener((state) => {
      setIsOffline(state.isConnected === false);
    });
  }, []);

  return <NetworkContext.Provider value={{ isOffline }}>{children}</NetworkContext.Provider>;
}

export function useNetwork() {
  return useContext(NetworkContext);
}
