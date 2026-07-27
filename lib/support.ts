import { supabase, getCurrentUserId } from "./supabase";

export type SupportStatus = "open" | "resolved";

export interface SupportMessage {
  id: string;
  user_id: string;
  body: string;
  status: SupportStatus;
  resolution_note: string | null;
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
  // Set every time an admin opens this ticket's conversation (see
  // markSupportThreadRead) — drives SupportConversation.needsResponse below,
  // independent of whether an admin has actually replied yet.
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

// Returns the created ticket (not just void) — app/support.tsx is a single
// running conversation now, not a picker over several tickets, so it needs
// this row's id immediately to know which ticket every reply after the
// first message should attach to.
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

// The full thread for one ticket — every reply, oldest first, from either
// side. Rendered under the ticket's own original body (support_messages.body)
// by both app/support.tsx (user) and app/admin/support/[userId].tsx (admin).
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

  await supabase
    .from("support_messages")
    .update({ status: "open" })
    .eq("id", messageId)
    .eq("status", "resolved");

  return data as SupportReply;
}

// Everything below is admin-only in practice (see the RLS policies in
// supabase/schema.sql) — mirrors lib/reports.ts's own split.

export interface SupportConversation {
  // The user's most recent ticket — mirrors app/support.tsx's own "single
  // running conversation" model, so the admin console lists one row per
  // person, not per historical ticket.
  ticketId: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  lastBody: string;
  lastAt: string;
  // True when there's activity since an admin last actually opened this
  // conversation (see markSupportThreadRead) — opening it is what clears
  // this, not sending a reply. Replaces the old open/resolved status tabs,
  // which required a separate "mark resolved" action that didn't reflect
  // whether anyone had actually read the message at all.
  needsResponse: boolean;
}

// One row per user with at least one support ticket, newest activity first.
// Three queries total regardless of how many users/tickets exist (messages,
// their latest replies, and the profiles to label them with) rather than
// one round trip per conversation.
export async function fetchSupportConversationsForAdmin(): Promise<SupportConversation[]> {
  const { data: messagesData, error: messagesError } = await supabase
    .from("support_messages")
    .select("*")
    .order("created_at", { ascending: false });
  if (messagesError) throw messagesError;
  const messages = messagesData as SupportMessage[];

  const latestByUser = new Map<string, SupportMessage>();
  for (const m of messages) {
    if (!latestByUser.has(m.user_id)) latestByUser.set(m.user_id, m);
  }
  const tickets = [...latestByUser.values()];
  if (tickets.length === 0) return [];

  const ticketIds = tickets.map((ticket) => ticket.id);
  const { data: repliesData, error: repliesError } = await supabase
    .from("support_message_replies")
    .select("*")
    .in("message_id", ticketIds)
    .order("created_at", { ascending: false });
  if (repliesError) throw repliesError;
  const replies = repliesData as SupportReply[];

  const lastReplyByTicket = new Map<string, SupportReply>();
  for (const r of replies) {
    if (!lastReplyByTicket.has(r.message_id)) lastReplyByTicket.set(r.message_id, r);
  }

  const userIds = tickets.map((ticket) => ticket.user_id);
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("user_id, username, avatar_url")
    .in("user_id", userIds);
  if (profilesError) throw profilesError;
  const profileById = new Map((profiles ?? []).map((p) => [p.user_id, p]));

  return tickets
    .map((ticket) => {
      const lastReply = lastReplyByTicket.get(ticket.id);
      const profile = profileById.get(ticket.user_id);
      const lastAt = lastReply?.created_at ?? ticket.created_at;
      // A ticket answered under the old single-resolution_note model (no
      // rows in support_message_replies, no admin_read_at either, since both
      // are new) already has its answer — without this fallback it looked
      // permanently unread forever, same as a genuinely fresh ticket.
      const alreadyAnsweredLegacy = !lastReply && !ticket.admin_read_at && !!ticket.resolution_note;
      return {
        ticketId: ticket.id,
        userId: ticket.user_id,
        username: profile?.username ?? ticket.user_id.slice(0, 8),
        avatarUrl: profile?.avatar_url ?? null,
        lastBody: lastReply?.body ?? ticket.body,
        lastAt,
        needsResponse: !alreadyAnsweredLegacy && (!ticket.admin_read_at || ticket.admin_read_at < lastAt),
      };
    })
    .sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
}

// Number of conversations whose last message is still the user's — the
// admin-menu alert dot (see app/(tabs)/profile.tsx), replacing the old
// status='open' count now that resolve/reopen no longer exists as a concept.
export async function fetchSupportNeedsResponseCount(): Promise<number> {
  const conversations = await fetchSupportConversationsForAdmin();
  return conversations.filter((c) => c.needsResponse).length;
}

// The one user's latest ticket + its full thread — app/admin/support/[userId].tsx's
// data source, mirroring app/support.tsx's own shape on the user side.
export async function fetchUserSupportThread(
  userId: string
): Promise<{ ticket: SupportMessage | null; replies: SupportReply[] }> {
  const { data, error } = await supabase
    .from("support_messages")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const ticket = data as SupportMessage | null;
  if (!ticket) return { ticket: null, replies: [] };
  return { ticket, replies: await fetchSupportReplies(ticket.id) };
}

// Admin-side reply — appends to the thread and bumps admin_read_at to now,
// same as markSupportThreadRead below. Without this, sending a reply right
// after opening the conversation would leave the reply itself timestamped
// *after* the read marker set on open, making the admin's own message look
// like new unread activity and flipping needsResponse back on immediately.
export async function sendAdminSupportReply(messageId: string, body: string): Promise<SupportReply> {
  const adminId = await getCurrentUserId();
  if (!adminId) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("support_message_replies")
    .insert({ message_id: messageId, author_id: adminId, is_admin: true, body: body.trim() })
    .select()
    .single();
  if (error) throw error;

  await markSupportThreadRead(messageId);

  return data as SupportReply;
}

// Called when an admin opens a conversation (see
// app/admin/support/[userId].tsx) — this alone is what clears the "needs
// reply" badge, independent of whether they actually send a reply.
export async function markSupportThreadRead(messageId: string): Promise<void> {
  const { error } = await supabase
    .from("support_messages")
    .update({ admin_read_at: new Date().toISOString() })
    .eq("id", messageId);
  if (error) throw error;
}
