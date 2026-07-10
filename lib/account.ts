import { Platform, Share } from "react-native";
import { supabase, getCurrentUserId } from "./supabase";

export async function changePassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

// Every table below is scoped to the current user directly (not through the
// existing fetchX() helpers elsewhere, several of which apply extra filters
// — e.g. fetchUserMovies() only returns status='watched' — where this needs
// literally every row the account owns, so a GDPR-style "download my data"
// export is actually complete.
async function collectUserData(userId: string): Promise<Record<string, unknown>> {
  const tables = [
    "user_shows",
    "watched_episodes",
    "lists",
    "list_items",
    "user_movies",
    "user_settings",
    "profiles",
    "comments",
    "comment_reactions",
    "character_votes",
    "movie_comments",
    "movie_comment_reactions",
    "reports",
  ] as const;

  const userIdColumn: Partial<Record<(typeof tables)[number], string>> = {
    profiles: "user_id",
    reports: "reporter_id",
  };

  const entries = await Promise.all(
    tables.map(async (table) => {
      const column = userIdColumn[table] ?? "user_id";
      const { data, error } = await supabase.from(table).select("*").eq(column, userId);
      // A table erroring out (e.g. an RLS edge case) shouldn't block every
      // other table's data from being exported — surfaced as an explicit
      // marker in the export instead of silently dropping the section.
      return [table, error ? { error: error.message } : data] as const;
    })
  );

  const [followerRows, followedRows] = await Promise.all([
    supabase.from("follows").select("*").eq("follower_id", userId),
    supabase.from("follows").select("*").eq("followed_id", userId),
  ]);

  return {
    exported_at: new Date().toISOString(),
    ...Object.fromEntries(entries),
    follows_as_follower: followerRows.data ?? [],
    follows_as_followed: followedRows.data ?? [],
  };
}

// Web downloads a .json file directly; native shares the JSON as text
// (there's no bundled file-sharing package here — see lib/account.ts's
// import list — so this keeps the dependency footprint the same rather
// than adding expo-sharing just for this one flow). Fine for the sizes a
// single account's data realistically reaches; a very large export may hit
// the native share sheet's message-length limit.
export async function exportMyData(): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const data = await collectUserData(userId);
  const json = JSON.stringify(data, null, 2);

  if (Platform.OS === "web") {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `epify-data-export-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return;
  }

  await Share.share({ message: json, title: "Epify data export" });
}

// Calls the delete-account Edge Function (see supabase/functions/delete-account)
// rather than deleting rows from the client: removing the actual auth.users
// row requires the service role key, which never ships to a client, and it's
// what cascades every other table (shows, movies, comments, reports, etc. —
// see the "on delete cascade" foreign keys in supabase/schema.sql) in one
// step instead of the client having to delete each table individually and
// hope nothing was missed.
export async function deleteAccount(): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Not authenticated");

  const { error } = await supabase.functions.invoke("delete-account", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) throw error;

  await supabase.auth.signOut();
}
