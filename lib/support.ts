import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, getCurrentUserId } from "./supabase";
import { fetchProfiles } from "./profiles";
import { createShortCache } from "./shortCache";

// Admin badge count, polled on every navigation focus (see
// app/(tabs)/_layout.tsx) — same reasoning as lib/notifications.ts's
// unreadCountCache, and now the same *shape* as lib/reports.ts's own
// openReportCountCache: support tickets are tickets too (see this file's
// own top comment), so "needs attention" is just "status = open", exactly
// like reports.
const openTicketCountCache = createShortCache<number>(20_000);

// Called on sign-out (see context/AuthContext.tsx) — not scoped by user id.
// Kept under its original name (clearSupportNeedsResponseCountCache) even
// though what it clears changed shape, so every call site (AuthContext)
// needed zero changes for this ticket-model rewrite.
export function clearSupportNeedsResponseCountCache() {
  openTicketCountCache.invalidate();
}

export type SupportStatus = "open" | "resolved";

// Each support message is its own ticket now — previously the client
// treated a user's single most recent row as "the" ongoing conversation
// and piled every later message onto it as a reply. That read fine for one
// person asking one thing, but a second, unrelated question became a reply
// buried in an old thread instead of its own trackable item — exactly the
// same one-shot-vs-ticket gap this file's reports.ts sibling just fixed.
// Sending a new message (see sendSupportMessage) always starts a fresh
// ticket; a reply (sendSupportReply) always targets one specific ticket id.
export interface SupportMessage {
  id: string;
  user_id: string;
  body: string;
  status: SupportStatus;
  resolution_note: string | null;
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
  // Legacy — set by the old single-conversation model's "mark read" step
  // (markSupportThreadRead, no longer called). Left populated on old rows;
  // status (open/resolved) is what "needs attention" goes by now.
  admin_read_at: string | null;
}

export interface SupportReply {
  id: string;
  message_id: string;
  author_id: string;
  is_admin: boolean;
  body: string;
  created_at: string;
}

// Always creates a new ticket — app/support.tsx's "New message" composer.
export async function sendSupportMessage(body: string): Promise<SupportMessage> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("support_messages")
    .insert({ user_id: userId, body: body.trim() })
    .select()
    .single();
  if (error) throw error;
  return data as SupportMessage;
}

// Every ticket the caller has ever sent, newest first — app/support.tsx's
// own ticket list (one row per entry, not collapsed to "the latest one").
export async function fetchMySupportMessages(): Promise<SupportMessage[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from("support_messages")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as SupportMessage[];
}

// One ticket by id — app/support/[id].tsx and app/admin/support/[id].tsx's
// shared data source (RLS scopes which rows each side can actually reach).
export async function fetchSupportMessageById(id: string): Promise<SupportMessage | null> {
  const { data, error } = await supabase.from("support_messages").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as SupportMessage | null;
}

// The full thread for one ticket — every reply, oldest first, from either
// side. Rendered under the ticket's own original body (support_messages.body)
// by both app/support/[id].tsx (user) and app/admin/support/[id].tsx (admin).
export async function fetchSupportReplies(messageId: string): Promise<SupportReply[]> {
  const { data, error } = await supabase
    .from("support_message_replies")
    .select("*")
    .eq("message_id", messageId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data as SupportReply[];
}

// User-side reply. A reply on a ticket the admin had already marked
// "resolved" reopens it — without this, a follow-up question after a
// resolution silently vanished into a ticket no admin was still watching.
export async function sendSupportReply(messageId: string, body: string): Promise<SupportReply> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("support_message_replies")
    .insert({ message_id: messageId, author_id: userId, is_admin: false, body: body.trim() })
    .select()
    .single();
  if (error) throw error;

  await supabase.from("support_messages").update({ status: "open" }).eq("id", messageId).eq("status", "resolved");

  return data as SupportReply;
}

// Live updates for one ticket's thread (app/support/[id].tsx and
// app/admin/support/[id].tsx both use this) — a channel per messageId,
// filtered server-side so only inserts for this specific ticket are
// delivered, instead of every reply in the whole support_message_replies
// table. The caller is responsible for deduping against its own optimistic
// insert (see mergeReply below) — this fires for every insert including the
// one the current device itself just made.
//
// Requires support_message_replies to be added to the `supabase_realtime`
// publication (see supabase/schema.sql) — unlike some Supabase Cloud
// defaults, a self-hosted instance has Realtime opt-in per table, so without
// that migration this subscribes successfully but silently never receives
// anything.
export function subscribeToSupportReplies(
  messageId: string,
  onInsert: (reply: SupportReply) => void
): RealtimeChannel {
  return supabase
    .channel(`support_replies:${messageId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "support_message_replies", filter: `message_id=eq.${messageId}` },
      (payload) => onInsert(payload.new as SupportReply)
    )
    .subscribe();
}

// Appends a reply arriving over realtime unless it's already present — the
// sender's own device already added it optimistically (see handleSend in
// both screens), and Realtime broadcasts every insert including the
// current device's own, so without this every message you send yourself
// would immediately double up as soon as the echo arrives.
export function mergeReply(prev: SupportReply[], incoming: SupportReply): SupportReply[] {
  if (prev.some((r) => r.id === incoming.id)) return prev;
  return [...prev, incoming];
}

// Everything below is admin-only in practice (see the RLS policies in
// supabase/schema.sql) — mirrors lib/reports.ts's own split, and now its
// own ticket-list shape too: one row per ticket, exactly like fetchReports,
// not one row per user.

export interface SupportTicket extends SupportMessage {
  username: string;
  avatarUrl: string | null;
}

export async function fetchSupportTickets(status?: SupportStatus): Promise<SupportTicket[]> {
  let query = supabase.from("support_messages").select("*").order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  const tickets = data as SupportMessage[];

  const userIds = Array.from(new Set(tickets.map((t) => t.user_id)));
  const profiles = await fetchProfiles(userIds).catch(() => []);
  const profileById = new Map(profiles.map((p) => [p.user_id, p]));

  return tickets.map((ticket) => {
    const profile = profileById.get(ticket.user_id);
    return { ...ticket, username: profile?.username ?? ticket.user_id.slice(0, 8), avatarUrl: profile?.avatar_url ?? null };
  });
}

// Admin-menu alert dot (see app/(tabs)/profile.tsx) — a ticket "needs
// attention" exactly when it's still open, same convention
// lib/reports.ts's fetchOpenReportCount uses, now that each support message
// is its own tracked ticket rather than a standing conversation.
export async function fetchSupportNeedsResponseCount(): Promise<number> {
  return openTicketCountCache.getOrFetch(async () => {
    const { count, error } = await supabase.from("support_messages").select("id", { count: "exact", head: true }).eq("status", "open");
    if (error) throw error;
    return count ?? 0;
  });
}

// Admin-side reply — appends to the thread. Independent of resolve: an
// admin can reply any time, before or after marking the ticket resolved.
export async function sendAdminSupportReply(messageId: string, body: string): Promise<SupportReply> {
  const adminId = await getCurrentUserId();
  if (!adminId) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("support_message_replies")
    .insert({ message_id: messageId, author_id: adminId, is_admin: true, body: body.trim() })
    .select()
    .single();
  if (error) throw error;
  return data as SupportReply;
}

export async function resolveSupportTicket(id: string): Promise<void> {
  const adminId = await getCurrentUserId();
  const { error } = await supabase
    .from("support_messages")
    .update({ status: "resolved", resolved_by: adminId, resolved_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
  openTicketCountCache.invalidate();
}
