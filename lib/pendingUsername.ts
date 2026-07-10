import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "pending_username";

// Bridges the gap between signup (where the username is actually typed) and
// the moment a profile row can legally be created (needs an authenticated
// session — see supabase/schema.sql's "Users create their own profile"
// policy). When Supabase requires email confirmation, signUp() returns no
// session yet, so there's nothing to attach the username to at that point.
// Stashing it here lets AuthContext finish the job silently the next time
// this device sees a real session (first login after confirming), instead
// of asking the user to type their username a second time.
export async function savePendingUsername(username: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, username);
  } catch {
    // Best-effort — worst case the user is prompted for a username some
    // other way later; nothing here is data that can't be re-entered.
  }
}

export async function consumePendingUsername(): Promise<string | null> {
  try {
    const value = await AsyncStorage.getItem(KEY);
    if (value) await AsyncStorage.removeItem(KEY);
    return value;
  } catch {
    return null;
  }
}
