import { useEffect, useRef, useState } from "react";
import { useLanguage } from "./i18n";
import { fetchShareableRoomsCached, ShareableRoom } from "./rooms";

// Shared "should the FeelingSheet popup appear, and with what" logic
// between app/(tabs)/index.tsx's Watch Next tap and app/show/[id].tsx's
// per-episode row tap — both need the exact same decision (show_feeling_
// prompt OR being in a room, see components/FeelingSheet.tsx) and the same
// room list, just applied to a different kind of "item" (a Watch Next row
// vs. a TVMazeEpisode), hence the generic.
export function useWatchedFeelingPrompt<T>() {
  const { showFeelingPrompt } = useLanguage();
  const showFeelingPromptRef = useRef(showFeelingPrompt);
  useEffect(() => {
    showFeelingPromptRef.current = showFeelingPrompt;
  }, [showFeelingPrompt]);

  const [promptItem, setPromptItem] = useState<T | null>(null);
  const [rooms, setRooms] = useState<ShareableRoom[]>([]);
  const roomsRef = useRef<ShareableRoom[]>([]);

  // Prefetched on mount (20s-TTL cache, see lib/rooms.ts) so the first
  // "just watched" tap doesn't wait on a network round trip to decide
  // whether to show the sheet at all.
  useEffect(() => {
    let active = true;
    fetchShareableRoomsCached().then((r) => {
      if (!active) return;
      roomsRef.current = r;
      setRooms(r);
    });
    return () => {
      active = false;
    };
  }, []);

  // Call on the unwatched -> watched transition. Returns whether the sheet
  // will actually show, so the caller can fall back to its own lighter
  // "just flash a checkmark" behavior when it won't (see justWatchedTimer
  // in app/(tabs)/index.tsx).
  function trigger(item: T): boolean {
    if (showFeelingPromptRef.current || roomsRef.current.length > 0) {
      setPromptItem(item);
      return true;
    }
    return false;
  }

  function close() {
    setPromptItem(null);
  }

  return { promptItem, rooms, trigger, close };
}
