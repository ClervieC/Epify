-- Run this in the Supabase SQL editor for your project.
--
-- Self-hosted (VPS/Docker) only: unlike Supabase Cloud, where the SQL
-- editor runs as the postgres superuser and grants everything implicitly,
-- a self-hosted instance needs REFERENCES on auth.users granted explicitly
-- before any of the many tables below that do `references auth.users (id)`
-- can be created — otherwise this whole file fails partway through with
-- `42501: permission denied for table users`. Run once, connected as
-- supabase_admin:
--   sudo docker exec -it <postgres_container_name> psql -U supabase_admin -d postgres -c "
--     GRANT REFERENCES ON auth.users TO postgres;
--     GRANT REFERENCES ON auth.users TO anon, authenticated, service_role;
--   "

create type show_status as enum ('watching', 'want_to_watch', 'watched', 'dropped', 'paused');

-- Run this instead if show_status already exists from a previous version of this schema:
-- alter type show_status add value if not exists 'paused';

create table if not exists public.user_shows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tvmaze_id integer not null,
  show_name text not null,
  show_image text,
  status show_status not null default 'want_to_watch',
  is_favorite boolean not null default false,
  rating smallint check (rating between 1 and 5),
  feeling text,
  current_season integer,
  current_episode integer,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, tvmaze_id)
);

-- Run this if user_shows already exists from a previous version of this schema:
-- alter table public.user_shows add column if not exists is_favorite boolean not null default false;

alter table public.user_shows enable row level security;

create policy "Users manage their own shows"
  on public.user_shows
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Lets a user's shows/favorites be shown on their public profile page.
create policy "Shows are viewable by authenticated users"
  on public.user_shows
  for select
  using (auth.role() = 'authenticated');

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger user_shows_set_updated_at
  before update on public.user_shows
  for each row
  execute function public.set_updated_at();

create table if not exists public.watched_episodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tvmaze_show_id integer not null,
  tvmaze_episode_id integer not null,
  season integer not null,
  number integer not null,
  watched boolean not null default true,
  watched_at timestamptz not null default now(),
  rating smallint check (rating between 1 and 5),
  feeling text,
  times_watched integer not null default 1,
  unique (user_id, tvmaze_episode_id)
);

-- Run this if watched_episodes already exists from a previous version of this schema:
-- alter table public.watched_episodes add column if not exists times_watched integer not null default 1;

alter table public.watched_episodes enable row level security;

create policy "Users manage their own watched episodes"
  on public.watched_episodes
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Lets episode-watched counts (TV time, episodes watched) show up on a
-- user's public profile page, same spirit as the user_shows read policy above.
create policy "Watched episodes are viewable by authenticated users"
  on public.watched_episodes
  for select
  using (auth.role() = 'authenticated');

create index if not exists watched_episodes_show_idx
  on public.watched_episodes (user_id, tvmaze_show_id);

create table if not exists public.lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.lists enable row level security;

create policy "Users manage their own lists"
  on public.lists
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  tvmaze_id integer not null,
  show_name text not null,
  show_image text,
  created_at timestamptz not null default now(),
  unique (list_id, tvmaze_id)
);

alter table public.list_items enable row level security;

create policy "Users manage their own list items"
  on public.list_items
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.user_movies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  year integer,
  watched_at timestamptz not null default now(),
  times_watched integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, title, year)
);

alter table public.user_movies enable row level security;

create policy "Users manage their own movies"
  on public.user_movies
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger user_movies_set_updated_at
  before update on public.user_movies
  for each row
  execute function public.set_updated_at();

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  spoiler_mode boolean not null default false,
  language text not null default 'en' check (language in ('en', 'fr')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

create policy "Users manage their own settings"
  on public.user_settings
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row
  execute function public.set_updated_at();

-- Public-ish identity used for search/follow, separate from auth.users (which clients
-- can't query directly). Anyone authenticated can read profiles; only the owner can
-- create/edit theirs.
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-zA-Z0-9_]{3,20}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Profiles are viewable by authenticated users"
  on public.profiles
  for select
  using (auth.role() = 'authenticated');

create policy "Users create their own profile"
  on public.profiles
  for insert
  with check (auth.uid() = user_id);

create policy "Users update their own profile"
  on public.profiles
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- Following requires both sides to have a profile (i.e. a username), which is also
-- what makes them findable via search in the first place.
create table if not exists public.follows (
  follower_id uuid not null references public.profiles (user_id) on delete cascade,
  followed_id uuid not null references public.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id)
);

alter table public.follows enable row level security;

create policy "Follows are viewable by authenticated users"
  on public.follows
  for select
  using (auth.role() = 'authenticated');

create policy "Users create their own follows"
  on public.follows
  for insert
  with check (auth.uid() = follower_id);

create policy "Users remove their own follows"
  on public.follows
  for delete
  using (auth.uid() = follower_id);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  type text not null,
  actor_id uuid references public.profiles (user_id) on delete set null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

create policy "Users see their own notifications"
  on public.notifications
  for select
  using (auth.uid() = user_id);

create policy "Users mark their own notifications read"
  on public.notifications
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- No insert policy for regular users: rows are only ever created by the trigger below,
-- which runs as the function owner and bypasses RLS. A follower's session can't insert
-- into someone else's notifications directly (auth.uid() would never match user_id).
create or replace function public.notify_on_follow()
returns trigger as $$
begin
  insert into public.notifications (user_id, type, actor_id)
  values (new.followed_id, 'follow', new.follower_id);
  return new;
end;
$$ language plpgsql security definer;

create trigger follows_notify
  after insert on public.follows
  for each row
  execute function public.notify_on_follow();

-- Comments on a show (target_type='show') or a specific episode
-- (target_type='episode', tvmaze_episode_id set). Episode comments always
-- carry the show id too, alongside the episode id, so a client can query/
-- delete by show without a join. Same read-everyone/write-your-own shape as
-- user_shows/watched_episodes above; the client is responsible for hiding
-- episode comments behind spoiler mode until the episode is watched, the same
-- way it already gates watched-episode data.
create type comment_target as enum ('show', 'episode');

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  target_type comment_target not null,
  tvmaze_show_id integer not null,
  tvmaze_episode_id integer,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  check (target_type = 'episode' or tvmaze_episode_id is null),
  check (target_type = 'show' or tvmaze_episode_id is not null)
);

alter table public.comments enable row level security;

create policy "Users manage their own comments"
  on public.comments
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Comments are viewable by authenticated users"
  on public.comments
  for select
  using (auth.role() = 'authenticated');

create index if not exists comments_show_idx
  on public.comments (tvmaze_show_id, target_type, created_at);
create index if not exists comments_episode_idx
  on public.comments (tvmaze_episode_id)
  where tvmaze_episode_id is not null;

-- One reaction (heart) per user per comment — toggled on/off, not a pick from
-- multiple reaction types.
create table if not exists public.comment_reactions (
  comment_id uuid not null references public.comments (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

alter table public.comment_reactions enable row level security;

create policy "Users manage their own comment reactions"
  on public.comment_reactions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Comment reactions are viewable by authenticated users"
  on public.comment_reactions
  for select
  using (auth.role() = 'authenticated');

-- One active "favorite character of this episode" vote per user per episode —
-- voting again just replaces it (upsert on the primary key). Character/person
-- name and image are denormalized at vote time so the tally stays renderable
-- even if a later cast fetch drops or reorders that person.
create table if not exists public.character_votes (
  user_id uuid not null references auth.users (id) on delete cascade,
  tvmaze_show_id integer not null,
  tvmaze_episode_id integer not null,
  person_id integer not null,
  person_name text not null,
  person_image text,
  character_id integer not null,
  character_name text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, tvmaze_episode_id)
);

alter table public.character_votes enable row level security;

create policy "Users manage their own character votes"
  on public.character_votes
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Character votes are viewable by authenticated users"
  on public.character_votes
  for select
  using (auth.role() = 'authenticated');

create index if not exists character_votes_episode_idx
  on public.character_votes (tvmaze_episode_id);

-- ============================================================
-- Movie features: personal watchlist status, favorites, ratings/
-- feelings, comments, and a stable TMDB id for matching.
-- Run this block against an existing database — it's purely additive
-- (new columns with defaults, new tables), so it's safe to run once.
-- ============================================================

-- tmdb_id is nullable: rows imported from a TV Time export never had one,
-- only movies added going forward (from Explore or the detail screen) do.
-- watched_at loses its NOT NULL/default because a 'want_to_watch' row has no
-- watch date yet — it's only set when the movie is actually marked watched.
alter table public.user_movies add column if not exists tmdb_id integer;
alter table public.user_movies add column if not exists status text not null default 'watched' check (status in ('want_to_watch', 'watched'));
alter table public.user_movies add column if not exists is_favorite boolean not null default false;
alter table public.user_movies add column if not exists rating smallint check (rating between 1 and 5);
alter table public.user_movies add column if not exists feeling text;
alter table public.user_movies alter column watched_at drop not null;
alter table public.user_movies alter column watched_at drop default;

create index if not exists user_movies_status_idx on public.user_movies (user_id, status);

-- Movie comments — same read-everyone/write-your-own shape as `comments`,
-- kept as a separate table (rather than extending `comments`) since movies
-- have no tvmaze id to key off of and altering that table's existing check
-- constraints/enum in place is riskier than an additive new table.
create table if not exists public.movie_comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tmdb_id integer not null,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

alter table public.movie_comments enable row level security;

create policy "Users manage their own movie comments"
  on public.movie_comments
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Movie comments are viewable by authenticated users"
  on public.movie_comments
  for select
  using (auth.role() = 'authenticated');

create index if not exists movie_comments_tmdb_idx
  on public.movie_comments (tmdb_id, created_at);

create table if not exists public.movie_comment_reactions (
  comment_id uuid not null references public.movie_comments (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

alter table public.movie_comment_reactions enable row level security;

create policy "Users manage their own movie comment reactions"
  on public.movie_comment_reactions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Movie comment reactions are viewable by authenticated users"
  on public.movie_comment_reactions
  for select
  using (auth.role() = 'authenticated');

-- ============================================================
-- Performance indexes for query patterns that were previously relying on
-- RLS's `user_id = auth.uid()` predicate alone (or a composite index whose
-- leading column doesn't match the actual filter) and falling back to a
-- full scan + sort. Purely additive — safe to run once against an existing
-- database.
-- ============================================================

-- fetchNotifications (order by created_at) and fetchUnreadNotificationCount
-- (filter on read = false) both run on every Profile tab visit and every
-- tab-bar focus.
create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (user_id)
  where not read;

-- fetchWatchedEpisodesPage (Watch List's lazy-loaded History section) sorts
-- by watched_at, which watched_episodes_show_idx doesn't cover.
create index if not exists watched_episodes_watched_at_idx
  on public.watched_episodes (user_id, watched_at desc);

-- rateEpisode/fetchEpisodeFeelingCounts/incrementRewatch filter solely on
-- tvmaze_episode_id (no user_id/show_id predicate) — run on every episode
-- detail view and every rewatch tap.
create index if not exists watched_episodes_episode_idx
  on public.watched_episodes (tvmaze_episode_id);

-- fetchFollowerIds and the "followers" half of fetchFollowCounts filter on
-- followed_id alone, which the (follower_id, followed_id) primary key can't
-- serve efficiently since followed_id isn't its leading column.
create index if not exists follows_followed_idx
  on public.follows (followed_id);

-- fetchEpisodeComments orders by created_at after filtering on
-- tvmaze_episode_id — comments_episode_idx only covered the filter, not the
-- sort. Superseded by the composite index below (safe to drop
-- comments_episode_idx if you want, it's now redundant).
create index if not exists comments_episode_created_idx
  on public.comments (tvmaze_episode_id, created_at)
  where tvmaze_episode_id is not null;

-- Stores each movie's TMDB poster path at write time (add-to-watchlist or
-- mark-watched), so the Movies grid can render a poster directly instead of
-- every MovieCard independently re-searching TMDB by title+year on mount —
-- a real per-card network/cache lookup across a grid of hundreds of movies.
-- Rows written before this existed simply have poster_path null; MovieCard
-- still falls back to the title+year search for those.
alter table public.user_movies add column if not exists poster_path text;

-- Superseded below — a plain "viewable by authenticated users" policy on
-- user_movies would let any authenticated client SELECT * on any user's row
-- directly (RLS gates rows, not which columns a query happens to ask for),
-- exposing rating/watched_at/times_watched/is_favorite, not just the
-- anonymous feeling this was added for. Run this drop if that policy was
-- already applied from a previous version of this file:
drop policy if exists "User movies are viewable by authenticated users" on public.user_movies;

-- Narrow replacement: a SECURITY DEFINER function that returns only the
-- aggregate feeling counts for a given movie, so user_movies itself stays
-- locked to "auth.uid() = user_id" for every column while still letting
-- fetchMovieFeelingCounts (lib/userMovies.ts) see everyone's feeling, not
-- just the current user's.
create or replace function public.movie_feeling_counts(p_tmdb_id integer)
returns table (feeling text, count bigint)
language sql
security definer
set search_path = public
as $$
  select feeling, count(*)
  from public.user_movies
  where tmdb_id = p_tmdb_id and feeling is not null
  group by feeling;
$$;

grant execute on function public.movie_feeling_counts(integer) to authenticated;

-- ============================================================
-- Admin flag + content/user reporting. Purely additive — safe to run once
-- against an existing database.
-- ============================================================

-- Set manually on your own row from the Supabase dashboard (Table Editor ->
-- profiles -> your row -> is_admin = true). No client code ever sets this —
-- see the RLS policies below, which don't grant users update access to it.
alter table public.profiles add column if not exists is_admin boolean not null default false;

create type report_target as enum ('user', 'comment', 'movie_comment', 'show', 'episode', 'movie');
create type report_status as enum ('open', 'resolved', 'dismissed');

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  target_type report_target not null,
  -- Exactly one of these is set, matching target_type: a uuid FK for
  -- user/comment/movie_comment targets (rows that exist in this database),
  -- or a plain external id for show/episode (TVmaze) and movie (TMDB),
  -- which have no local row to foreign-key to.
  target_user_id uuid references auth.users (id) on delete cascade,
  target_comment_id uuid references public.comments (id) on delete cascade,
  target_movie_comment_id uuid references public.movie_comments (id) on delete cascade,
  target_tvmaze_show_id integer,
  target_tvmaze_episode_id integer,
  target_tmdb_id integer,
  reason text not null check (char_length(trim(reason)) between 1 and 500),
  status report_status not null default 'open',
  -- Admin-only moderation note (why resolved/dismissed) — never shown to
  -- the reporter.
  resolution_note text,
  resolved_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.reports enable row level security;

-- Reporters can file reports and see their own (so a future "my reports"
-- view could show status), but never anyone else's — a report often names
-- a specific person, which isn't something to expose broadly.
create policy "Users create their own reports"
  on public.reports
  for insert
  with check (auth.uid() = reporter_id);

create policy "Users view their own reports"
  on public.reports
  for select
  using (auth.uid() = reporter_id);

-- Admins see and act on every report. Checked directly against
-- profiles.is_admin — profiles is already readable by any authenticated
-- user (see "Profiles are viewable by authenticated users" above), so this
-- doesn't need a SECURITY DEFINER function to avoid an RLS deadlock.
create policy "Admins view all reports"
  on public.reports
  for select
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin));

create policy "Admins update reports"
  on public.reports
  for update
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin));

create index if not exists reports_status_idx on public.reports (status, created_at desc);
create index if not exists reports_reporter_idx on public.reports (reporter_id);

-- ============================================================
-- Show stats cache — the "watch time"/"episodes watched" detail page
-- (episodes/week, remaining episodes, genre breakdown) needs several TVmaze
-- calls per tracked show plus a full scan of watched_episodes, too slow to
-- redo on every visit. One row per user holding the last computed result as
-- JSON; the client repaints from this instantly and only recomputes (then
-- overwrites this row) when it's missing or older than the screen's own TTL.
-- Purely additive — safe to run once.
-- ============================================================
create table if not exists public.show_stats_cache (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null,
  computed_at timestamptz not null default now()
);

alter table public.show_stats_cache enable row level security;

create policy "Users manage their own show stats cache"
  on public.show_stats_cache
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- Favorite episodes — a heart toggle on an already-watched episode (see
-- episode/[id].tsx), listed in Profile the same way favorite shows/movies
-- already are. Just a column on watched_episodes rather than a separate
-- table: a favorite episode is inherently a watched one (nothing else has a
-- row here to attach it to), so this is a one-to-one flag on data that
-- already exists. Purely additive — safe to run once.
-- ============================================================
alter table public.watched_episodes
  add column if not exists is_favorite boolean not null default false;

-- ============================================================
-- User moderation — lets admins act on a person directly (not just on a
-- specific report), from a new "Users" section in the admin console
-- (app/admin/index.tsx). is_banned is enforced client-side (a banned user's
-- session still exists — this isn't auth-level revocation, just a flag the
-- app checks) for the same reason reports.status is: no server-side
-- deletion or lockout infrastructure exists yet, and a soft flag an admin
-- can reverse is a safer first step than something destructive. Purely
-- additive — safe to run once.
-- ============================================================
alter table public.profiles add column if not exists is_banned boolean not null default false;

create policy "Admins update any profile"
  on public.profiles
  for update
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin));

-- ============================================================
-- Profile photos — a Supabase Storage bucket, not a table. Public (read)
-- because avatars show up on other people's screens (comments, followers,
-- activity feed) the same way usernames already do; write is locked to a
-- user's own folder (avatars/{user_id}/...) via the storage.objects RLS
-- policies below, mirroring every other "own row only" policy in this file.
-- Purely additive — safe to run once.
-- ============================================================
alter table public.profiles add column if not exists avatar_url text;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "Avatar images are publicly readable"
  on storage.objects
  for select
  using (bucket_id = 'avatars');

create policy "Users upload their own avatar"
  on storage.objects
  for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users update their own avatar"
  on storage.objects
  for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users delete their own avatar"
  on storage.objects
  for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================
-- Support messages — a general "ask/tell the admins something" channel,
-- distinct from reports (public.reports): a report always names a specific
-- piece of content or user to moderate, with a fixed enum of target types;
-- this is free-form ("the import failed for X", "can you add Y feature"),
-- with nothing to attach it to. Mirrors the reports table's admin-facing
-- shape (status + resolution_note + resolved_by) so app/admin/index.tsx's
-- moderation-console patterns extend to it directly. Purely additive — safe
-- to run once.
-- ============================================================
create type support_status as enum ('open', 'resolved');

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  status support_status not null default 'open',
  resolution_note text,
  resolved_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.support_messages enable row level security;

create policy "Users create their own support messages"
  on public.support_messages
  for insert
  with check (auth.uid() = user_id);

create policy "Users view their own support messages"
  on public.support_messages
  for select
  using (auth.uid() = user_id);

create policy "Admins view all support messages"
  on public.support_messages
  for select
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin));

create policy "Admins update support messages"
  on public.support_messages
  for update
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin));

-- Lets lib/support.ts's sendSupportReply flip a resolved ticket's own status
-- back to 'open' when the user follows up on it — without this, only the
-- "Admins update" policy above could touch this table at all, so that
-- reopen-on-reply silently updated zero rows for every non-admin user.
create policy "Users reopen their own support messages"
  on public.support_messages
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists support_messages_status_idx on public.support_messages (status, created_at desc);
create index if not exists support_messages_user_idx on public.support_messages (user_id);

-- ============================================================
-- Support message replies — turns support_messages from a one-shot "send a
-- message, get a single resolution_note back" dead end into a real threaded
-- conversation. support_messages.body stays the ticket's original message;
-- every reply after that, from either the user or an admin, is a row here.
-- resolution_note/resolved_by/resolved_at stay on support_messages purely as
-- the "marked resolved" audit trail — the actual back-and-forth lives here.
-- Purely additive — safe to run once.
-- ============================================================
create table if not exists public.support_message_replies (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.support_messages (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  is_admin boolean not null default false,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

alter table public.support_message_replies enable row level security;

create policy "Users view replies on their own tickets"
  on public.support_message_replies
  for select
  using (
    exists (
      select 1 from public.support_messages m
      where m.id = message_id and m.user_id = auth.uid()
    )
  );

create policy "Users reply to their own tickets"
  on public.support_message_replies
  for insert
  with check (
    auth.uid() = author_id
    and is_admin = false
    and exists (
      select 1 from public.support_messages m
      where m.id = message_id and m.user_id = auth.uid()
    )
  );

create policy "Admins view all replies"
  on public.support_message_replies
  for select
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin));

create policy "Admins reply to any ticket"
  on public.support_message_replies
  for insert
  with check (
    auth.uid() = author_id
    and is_admin = true
    and exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin)
  );

create index if not exists support_message_replies_message_idx on public.support_message_replies (message_id, created_at);

-- ============================================================
-- Support "read" tracking — lets the admin console clear a conversation's
-- "needs reply" badge the moment an admin actually opens it (see
-- app/admin/support/[userId].tsx), independent of whether they've sent a
-- reply yet. Without this, needsResponse could only ever go by whether the
-- last message was an admin's own, which meant simply reading a message
-- without answering right away left the badge on forever (or, worse, gave
-- no way to acknowledge "I've seen this" at all). Purely additive — safe to
-- run once.
-- ============================================================
alter table public.support_messages add column if not exists admin_read_at timestamptz;

-- ============================================================
-- Badge unlocks — records the moment (device time, on whichever
-- device/session first notices it) each badge id (see lib/streaks.ts's
-- Badge.id, e.g. "episodes-100") flips to achieved, so app/streaks.tsx can
-- show "earned on <date>" instead of just a checkmark. Badges themselves
-- stay fully recomputed from current totals every visit (cheap, no need to
-- persist that) — this table only persists the one thing that can't be
-- recomputed after the fact: *when* a threshold was first crossed. Purely
-- additive — safe to run once.
-- ============================================================
create table if not exists public.badge_unlocks (
  user_id uuid not null references auth.users (id) on delete cascade,
  badge_id text not null,
  earned_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

alter table public.badge_unlocks enable row level security;

create policy "Users view their own badge unlocks"
  on public.badge_unlocks
  for select
  using (auth.uid() = user_id);

create policy "Users insert their own badge unlocks"
  on public.badge_unlocks
  for insert
  with check (auth.uid() = user_id);

-- ============================================================
-- Stale "want to watch" reminders — a one-time in-app notification when a
-- show has sat in want_to_watch longer than the user's chosen threshold
-- (asked once during onboarding, editable later in Settings; 0 = off). No
-- cron/edge function exists in this project — lib/staleWatchlist.ts runs the
-- check client-side on app open (see context/NotificationsContext.tsx) and
-- inserts straight into public.notifications. Purely additive — safe to run
-- once.
-- ============================================================
alter table public.user_settings
  add column if not exists stale_watchlist_months integer not null default 6
  check (stale_watchlist_months in (0, 6, 12));

alter table public.user_shows add column if not exists want_to_watch_since timestamptz;

-- Backfill: for shows already sitting in want_to_watch, treat their
-- existing created_at as the start of the wait — otherwise every row that
-- predates this column would look brand new and never qualify for a
-- reminder no matter how long it's actually been sitting there.
update public.user_shows
  set want_to_watch_since = created_at
  where status = 'want_to_watch' and want_to_watch_since is null;

alter table public.notifications add column if not exists tvmaze_show_id integer;
alter table public.notifications add column if not exists show_name text;
alter table public.notifications add column if not exists show_image text;

-- Only 'follow' notifications existed before this column, and they always
-- leave tvmaze_show_id null — Postgres treats every null as distinct from
-- every other null, so this only dedupes repeat stale_watchlist rows for
-- the same show, never across unrelated notification types.
create unique index if not exists notifications_user_show_unique
  on public.notifications (user_id, tvmaze_show_id);

-- Mirrors "Users insert their own badge unlocks" above — the client can only
-- ever insert a reminder about its own want_to_watch list, never spoof a
-- follow notification or write into another user's feed.
create policy "Users create their own watchlist reminders"
  on public.notifications
  for insert
  with check (
    auth.uid() = user_id
    and type = 'stale_watchlist'
    and actor_id is null
    and tvmaze_show_id is not null
  );

-- ============================================================
-- "People with similar taste" suggestions (Activity tab) — ranks other
-- users by the overlap coefficient (shared shows / the SMALLER of the two
-- lists, not just "% of my list") between their user_shows and the
-- caller's, so someone with a small list that's almost entirely a subset of
-- yours ranks as a strong match instead of getting buried by list-size
-- skew the way shared/my_total alone would. Written as an RPC rather than
-- a plain client-side select+group (mirrors movie_feeling_counts below) so
-- the intersection/count happens in Postgres instead of pulling every
-- candidate's user_shows rows to the client to aggregate in JS — no RLS
-- change needed since user_shows is already readable cross-user (see
-- "Shows are viewable by authenticated users" above), so this runs as the
-- caller (no security definer). Purely additive — safe to run once.
-- ============================================================
create index if not exists user_shows_tvmaze_id_idx on public.user_shows (tvmaze_id);

create or replace function public.suggested_show_buddies(p_limit integer default 20)
returns table (
  user_id uuid,
  shared_count integer,
  match_percent numeric
)
language sql
stable
as $$
  with mine as (
    select tvmaze_id from public.user_shows where user_shows.user_id = auth.uid()
  ),
  my_total as (
    select count(*)::integer as n from mine
  ),
  shared as (
    select us.user_id, count(*)::integer as shared_count
    from public.user_shows us
    join mine on mine.tvmaze_id = us.tvmaze_id
    where us.user_id <> auth.uid()
    group by us.user_id
  ),
  their_totals as (
    select user_shows.user_id, count(*)::integer as n
    from public.user_shows
    where user_shows.user_id in (select shared.user_id from shared)
    group by user_shows.user_id
  )
  select
    shared.user_id,
    shared.shared_count,
    round(
      shared.shared_count::numeric / greatest(least(my_total.n, their_totals.n), 1) * 100,
      1
    ) as match_percent
  from shared
  join their_totals on their_totals.user_id = shared.user_id
  cross join my_total
  where shared.shared_count::numeric / greatest(least(my_total.n, their_totals.n), 1) >= 0.10
    and not exists (
      select 1 from public.follows f
      where f.follower_id = auth.uid() and f.followed_id = shared.user_id
    )
  order by match_percent desc, shared.shared_count desc
  limit p_limit;
$$;

grant execute on function public.suggested_show_buddies(integer) to authenticated;

-- ============================================================
-- Public-profile movie list (app/users/[id].tsx) — user_movies has no
-- "viewable by authenticated users" policy on purpose (see the drop-policy
-- block above: a plain cross-user SELECT would expose rating/watched_at/
-- times_watched/is_favorite, not just title/poster). This mirrors
-- movie_feeling_counts's approach — a SECURITY DEFINER function that
-- hand-picks only the non-sensitive columns needed to render posters on
-- someone else's profile, rather than loosening the table's own RLS.
-- Purely additive — safe to run once.
-- ============================================================
create or replace function public.public_watched_movies(p_user_id uuid)
returns table (
  tmdb_id integer,
  title text,
  year integer,
  poster_path text
)
language sql
security definer
set search_path = public
as $$
  select tmdb_id, title, year, poster_path
  from public.user_movies
  where user_id = p_user_id and status = 'watched' and tmdb_id is not null
  order by watched_at desc nulls last
  limit 50;
$$;

grant execute on function public.public_watched_movies(uuid) to authenticated;

-- ============================================================
-- Movie-taste counterpart to suggested_show_buddies above — same overlap
-- coefficient, same exclusions (self, already-followed), same >=10%
-- threshold, just over user_movies instead of user_shows. Unlike
-- suggested_show_buddies, this one has to be SECURITY DEFINER: user_movies
-- has no cross-user SELECT policy (see public_watched_movies' comment
-- above), so a plain invoker-rights function would see only the caller's
-- own rows on both sides of the join and never find a match. Still only
-- ever returns a count + percentage, never the underlying rating/
-- watched_at/feeling columns that policy was written to keep private.
-- Purely additive — safe to run once.
-- ============================================================
create or replace function public.suggested_movie_buddies(p_limit integer default 20)
returns table (
  user_id uuid,
  shared_count integer,
  match_percent numeric
)
language sql
security definer
set search_path = public
stable
as $$
  with mine as (
    select tmdb_id from public.user_movies
    where user_movies.user_id = auth.uid() and status = 'watched' and tmdb_id is not null
  ),
  my_total as (
    select count(*)::integer as n from mine
  ),
  shared as (
    select um.user_id, count(*)::integer as shared_count
    from public.user_movies um
    join mine on mine.tmdb_id = um.tmdb_id
    where um.user_id <> auth.uid() and um.status = 'watched'
    group by um.user_id
  ),
  their_totals as (
    select user_movies.user_id, count(*)::integer as n
    from public.user_movies
    where user_movies.status = 'watched'
      and user_movies.user_id in (select shared.user_id from shared)
    group by user_movies.user_id
  )
  select
    shared.user_id,
    shared.shared_count,
    round(
      shared.shared_count::numeric / greatest(least(my_total.n, their_totals.n), 1) * 100,
      1
    ) as match_percent
  from shared
  join their_totals on their_totals.user_id = shared.user_id
  cross join my_total
  where shared.shared_count::numeric / greatest(least(my_total.n, their_totals.n), 1) >= 0.10
    and not exists (
      select 1 from public.follows f
      where f.follower_id = auth.uid() and f.followed_id = shared.user_id
    )
  order by match_percent desc, shared.shared_count desc
  limit p_limit;
$$;

grant execute on function public.suggested_movie_buddies(integer) to authenticated;

-- ============================================================
-- Rest of the public-profile movie surface (app/users/[id].tsx) — a watched
-- count (parallel to fetchEpisodeCount for shows) and a favorites row
-- (parallel to fetchFavorites for shows), both SECURITY DEFINER for the
-- same reason as public_watched_movies above: user_movies has no cross-user
-- SELECT policy on purpose, so a plain invoker-rights query would see
-- nothing. The count function returns only a number; the favorites
-- function hand-picks the same non-sensitive columns as
-- public_watched_movies (no rating/watched_at/feeling). Purely additive —
-- safe to run once.
-- ============================================================
create or replace function public.public_watched_movie_count(p_user_id uuid)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::integer
  from public.user_movies
  where user_id = p_user_id and status = 'watched';
$$;

grant execute on function public.public_watched_movie_count(uuid) to authenticated;

create or replace function public.public_favorite_movies(p_user_id uuid)
returns table (
  tmdb_id integer,
  title text,
  year integer,
  poster_path text
)
language sql
security definer
set search_path = public
stable
as $$
  select tmdb_id, title, year, poster_path
  from public.user_movies
  where user_id = p_user_id and is_favorite = true and tmdb_id is not null
  order by updated_at desc
  limit 50;
$$;

grant execute on function public.public_favorite_movies(uuid) to authenticated;

-- ============================================================
-- Per-user opt-out of the quick "how did that make you feel" reaction sheet
-- that pops up right after marking an episode watched from the Watch Next
-- list (see app/(tabs)/index.tsx's feelingPromptItem) — a couple of users
-- find it intrusive on every single check, so it's a personal Settings
-- toggle rather than a change to the feature itself. Defaults to true (the
-- existing behavior) so this is purely additive/opt-in to turn off.
-- ============================================================
alter table public.user_settings
  add column if not exists show_feeling_prompt boolean not null default true;

-- ============================================================
-- One-level-deep replies on comments (show/episode comments and movie
-- comments) — a reply is just a regular row with parent_comment_id set,
-- not a separate table. Nulls (the common case, a top-level comment) mean
-- the existing per-target indexes above already cover the "give me every
-- comment for this show/episode/movie" query; this index instead serves
-- "give me every reply to comment X" (see fetchEpisodeComments etc. building
-- the reply tree client-side).
-- ============================================================
alter table public.comments
  add column if not exists parent_comment_id uuid references public.comments (id) on delete cascade;
create index if not exists comments_parent_idx
  on public.comments (parent_comment_id)
  where parent_comment_id is not null;

alter table public.movie_comments
  add column if not exists parent_comment_id uuid references public.movie_comments (id) on delete cascade;
create index if not exists movie_comments_parent_idx
  on public.movie_comments (parent_comment_id)
  where parent_comment_id is not null;

-- ============================================================
-- Show-level reaction (rating + feeling), same shape as the existing
-- per-episode and per-movie ones. user_shows already had a `rating` column
-- from an earlier, never-shipped feature (no app code read or wrote it) —
-- reused here rather than adding a second one, with its check constraint
-- narrowed from the old 1-10 scale to the 1-5 scale rating/feeling already
-- use everywhere else (watched_episodes, user_movies).
-- ============================================================
alter table public.user_shows drop constraint if exists user_shows_rating_check;
alter table public.user_shows add constraint user_shows_rating_check check (rating between 1 and 5);
alter table public.user_shows add column if not exists feeling text;

-- fetchShowFeelingCounts (lib/userShows.ts) filters on tvmaze_id alone,
-- across every user's row — the existing (user_id, tvmaze_id) unique
-- constraint doesn't serve that (tvmaze_id isn't its leading column).
create index if not exists user_shows_tvmaze_idx on public.user_shows (tvmaze_id);

-- ============================================================
-- Realtime for the support chat (see lib/support.ts's
-- subscribeToSupportReplies, used by app/support.tsx and
-- app/admin/support/[userId].tsx) — a new reply appears live on the other
-- side's screen instead of only after they leave and refocus it.
--
-- On Supabase Cloud, adding a table to a project's replication is usually
-- done from the Dashboard (Database > Replication) and this block is a
-- no-op if it's already enabled there. On a self-hosted instance there's no
-- dashboard toggle — the table has to be added to the `supabase_realtime`
-- publication directly, or postgres_changes subscriptions connect
-- successfully but silently never deliver anything.
--
-- Wrapped in a existence check (unlike a plain `create table if not
-- exists`, `alter publication ... add table` has no built-in "if not
-- already a member" form, and errors on a second run otherwise) so this
-- stays safe to run again against a database that already has it enabled.
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'support_message_replies'
  ) then
    alter publication supabase_realtime add table public.support_message_replies;
  end if;
end $$;

-- ============================================================
-- Shared TMDB cache (supabase/functions/tmdb-cache) — a read-through cache
-- shared across every user, instead of every device spending more of TMDB's
-- single app-wide API key budget independently, for data that's identical
-- for everyone and rarely changes.
--
-- Keyed by the exact request path (e.g. "/movie/550/credits") rather than
-- one column/table per endpoint — this is what lets the Edge Function be a
-- single generic "cached proxy for any GET path on this API" instead of one
-- bespoke branch per endpoint, so adding another cached endpoint later is a
-- client-side change only, no schema/function change needed. The first
-- request for a given path, from anyone, populates the row; everyone else
-- (and every fresh install / cleared local cache) reads it back from here
-- instead of calling TMDB again.
--
-- Written only by the Edge Function, using the service role key (which
-- bypasses RLS) — there is deliberately no insert/update policy for the
-- `authenticated` role below, only select, so a buggy or malicious client
-- can never write bad data into a table every other user reads from.
-- Purely additive — safe to run once.
--
-- (Supersedes an earlier version of this block that used one table per
-- endpoint, kind — tvmaze_show_cache/tvmaze_episodes_cache/
-- tvmaze_cast_cache/tmdb_movie_cache/tmdb_tv_cache — and, briefly, a
-- tvmaze_api_cache generic table mirroring this one: a load test found the
-- TVmaze Edge Function path serializing badly under concurrency —
-- multi-second latency past ~20 simultaneous requests despite near-idle
-- CPU — so lib/tvmaze.ts went back to calling TVmaze directly, same as
-- before any of this existed. TMDB kept this treatment since its rate limit
-- is one shared app-wide budget, unlike TVmaze's per-IP one, so caching it
-- across users matters regardless of the Edge Function's own concurrency
-- ceiling. Run `drop table if exists public.tvmaze_api_cache;` if that
-- table was created on this database by the earlier version of this file.)
-- ============================================================
create table if not exists public.tmdb_api_cache (
  path text primary key,
  payload jsonb,
  fetched_at timestamptz not null default now()
);

alter table public.tmdb_api_cache enable row level security;

create policy "tmdb_api_cache_select_authenticated"
  on public.tmdb_api_cache for select
  using (auth.role() = 'authenticated');

-- ============================================================
-- Daily proactive refresh of the small, fixed set of TMDB "list" endpoints
-- (popular/top-rated/now-playing/upcoming, movies and TV) via
-- supabase/functions/refresh-lists — everything else in tmdb_api_cache only
-- refreshes *reactively*, whichever user's request happens to land right
-- after a row's TTL lapses (see lib/tmdb.ts). This makes refreshing those
-- specific rows a background job's cost instead of some unlucky user's page
-- load, on a predictable clock instead of "whenever someone happens to ask
-- right after it goes stale." Not extended to movie/show details, search,
-- or the per-user For You feeds — those are keyed by unbounded user input,
-- not this fixed, enumerable set of paths, so there's nothing to pre-warm.
--
-- refresh-lists is deployed with --no-verify-jwt (no real user session is
-- ever involved) and instead checks an X-Refresh-Secret header against a
-- secret only this cron job knows — kept in Vault, never in this file, so
-- run the vault.create_secret call below once yourself with your own
-- generated value (`openssl rand -hex 32`) rather than pasting one here.
-- Purely additive — safe to run once (cron.schedule below replaces any
-- existing job of the same name if re-run, so it's fine to adjust the
-- schedule and re-run just that call later too).
-- ============================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Run once, with your own generated secret (also set as this project's
-- REFRESH_SECRET Edge Function secret — `npx supabase secrets set
-- REFRESH_SECRET=<same value>`):
--   select vault.create_secret('<openssl rand -hex 32>', 'refresh_lists_secret');

-- `url` below is a placeholder — replace it with this project's own
-- functions endpoint before running: the internal Kong URL
-- (`http://kong:8000/functions/v1/refresh-lists`) for a self-hosted
-- instance, since pg_net's net.http_post runs from inside the Postgres
-- container on the same docker network; the public project URL
-- (`https://<project-ref>.supabase.co/functions/v1/refresh-lists`) for
-- Supabase Cloud.
select cron.schedule(
  'refresh-tmdb-lists',
  '0 4 * * *', -- daily at 04:00 UTC
  $$
  select net.http_post(
    url := 'REPLACE_WITH_YOUR_FUNCTIONS_URL/functions/v1/refresh-lists',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Refresh-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'refresh_lists_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ============================================================
-- Purely additive — no index covered user_shows(user_id, status) despite
-- that being the exact filter the app's hottest query uses (the "followed"
-- list — status = watching OR want_to_watch — loaded on every cold app
-- open, see app/(tabs)/index.tsx's fetchUserShows). Only the PK and the
-- (user_id, tvmaze_id) unique constraint existed, neither of which serve a
-- user_id + status filter on their own.
--
-- Also drops user_shows_tvmaze_id_idx: identical to user_shows_tvmaze_idx
-- (added earlier in this file for fetchShowFeelingCounts) — the same
-- column indexed twice under two different names, pure write-time waste.
--
-- CONCURRENTLY can't run inside a transaction block — run these two
-- statements directly via psql (or one at a time), not as part of a
-- whole-file paste into a SQL editor that wraps multi-statement pastes in
-- one implicit transaction.
-- ============================================================
create index concurrently if not exists user_shows_user_status_idx
  on public.user_shows (user_id, status);

drop index concurrently if exists public.user_shows_tvmaze_id_idx;

-- ============================================================
-- The TMDB-only show fallback (app/show/tmdb/[id].tsx, findTvmazeShowFromTmdbTv's
-- failure path) was removed — a show with no TVmaze match now just surfaces
-- a "not found" alert instead of a read-only TMDB-only detail page, so
-- nothing writes to this table anymore. Safe to drop.
-- ============================================================
drop table if exists public.tmdb_only_shows;

-- ============================================================
-- Reports can now include one or more screenshots (e.g. proof of
-- harassment, a broken show page) — components/ReportModal.tsx uploads
-- them to Storage first, then passes the resulting public URLs in here.
-- Capped at 5 client-side (see ReportModal.tsx); not re-enforced with a
-- check constraint here — a client bypassing its own limit only costs a
-- little extra storage, not worth the risk of getting ALTER TABLE ... ADD
-- CONSTRAINT's lack of IF NOT EXISTS support wrong in an idempotent script.
-- Purely additive — safe to run once.
-- ============================================================
alter table public.reports add column if not exists image_urls text[] not null default '{}';

-- Public (read), same reasoning/shape as the avatars bucket above — write
-- is locked to a user's own folder (report-images/{user_id}/...). Reports
-- themselves stay visible only to their reporter and admins (see the RLS
-- policies on public.reports above); the *image URLs* stored inside a
-- report row are plain public links regardless, same trust level as an
-- avatar URL — not advertised anywhere, but not access-controlled either.
insert into storage.buckets (id, name, public)
values ('report-images', 'report-images', true)
on conflict (id) do nothing;

create policy "Report images are publicly readable"
  on storage.objects
  for select
  using (bucket_id = 'report-images');

create policy "Users upload their own report images"
  on storage.objects
  for insert
  with check (bucket_id = 'report-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================
-- Shared, cross-user cache for TVmaze show/episode data — reintroduces an
-- earlier tvmaze_show_cache/tvmaze_episodes_cache/tvmaze_api_cache that was
-- reverted (see supabase/functions/refresh-lists/index.ts's own history)
-- after a load test found the Edge Function path serializing badly under
-- concurrency. This version avoids that: clients (lib/tvmaze.ts) read this
-- table directly via PostgREST — same fix already proven for tmdb_api_cache
-- above — and never call an Edge Function on the read path at all. Only
-- supabase/functions/refresh-tvmaze-cache (pg_cron, once daily, never
-- client-invoked) touches the Edge Function, which is exactly what the old
-- concurrency problem needed many *client* callers to trigger in the first
-- place.
--
-- Keyed by the real TVmaze path (`/shows/169`, `/shows/169/episodes`),
-- mirroring tmdb_api_cache's own keying convention.
--
-- One deliberate difference from tmdb_api_cache: authenticated users can
-- also upsert here (not just the service-role Edge Function) — a fresh
-- TVmaze fetch a client made on its own cache-miss gets written back here
-- too (see lib/tvmaze.ts's writeTvmazeSharedCache), so a newly-tracked show
-- becomes available to every other user immediately instead of waiting for
-- the next nightly refresh. The data being written is a public API
-- passthrough with no injection/abuse surface worth locking down further —
-- worst case a bad write is a stale value for one path, which self-heals
-- on the next real fetch or the next nightly refresh either way.
--
-- Purely additive — safe to run once.
-- ============================================================
create table if not exists public.tvmaze_api_cache (
  path text primary key,
  payload jsonb,
  fetched_at timestamptz not null default now()
);

alter table public.tvmaze_api_cache enable row level security;

create policy "tvmaze_api_cache_select_authenticated"
  on public.tvmaze_api_cache for select
  using (auth.role() = 'authenticated');

create policy "tvmaze_api_cache_upsert_authenticated"
  on public.tvmaze_api_cache for insert
  with check (auth.role() = 'authenticated');

create policy "tvmaze_api_cache_update_authenticated"
  on public.tvmaze_api_cache for update
  using (auth.role() = 'authenticated');

-- refresh-tvmaze-cache is deployed with --no-verify-jwt and gated by its
-- own shared secret header (REFRESH_TVMAZE_SECRET as its Edge Function
-- secret) — a *different* secret from refresh_lists_secret above, kept in
-- Vault, never in this file. Run once, with your own generated value:
--   select vault.create_secret('<openssl rand -hex 32>', 'refresh_tvmaze_secret');
-- and set the same value as this project's REFRESH_TVMAZE_SECRET Edge
-- Function secret (`npx supabase secrets set REFRESH_TVMAZE_SECRET=<same value>`).

-- `url` below is a placeholder — same replacement rule as refresh-tmdb-lists
-- above (internal Kong URL for a self-hosted instance, the public project
-- URL for Supabase Cloud). Scheduled an hour after the TMDB job so the two
-- don't compete for this VPS's own resources at the same moment.
select cron.schedule(
  'refresh-tvmaze-cache',
  '0 5 * * *', -- daily at 05:00 UTC
  $$
  select net.http_post(
    url := 'REPLACE_WITH_YOUR_FUNCTIONS_URL/functions/v1/refresh-tvmaze-cache',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Refresh-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'refresh_tvmaze_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ============================================================
-- Recap cache — app/recap.tsx's Month/Year recap (lib/recap.ts) needs a
-- watched_episodes/user_movies scan plus up to 15 TVmaze show fetches per
-- period; since every period it can even be asked for is already fully
-- over (see lastViewableMonth/maxViewableYear in lib/recap.ts — the
-- current, still-in-progress one is never computed at all), that result
-- never changes once computed, so it's worth keeping instead of redoing on
-- every visit. One row per (user, period) holding the computed result as
-- JSON.
--
-- lib/recap.ts also keeps a local IndexedDB mirror of this (its own
-- recapCache) — that one skips even this row's own read on a repeat visit
-- from the *same* device; this table is what makes a different device, or
-- a cleared local cache, still skip the real computation instead of paying
-- for it again, the same two-layer shape as show_stats_cache above plus
-- its own lib/showStats.ts local mirror.
--
-- period_key mirrors lib/recap.ts's own recapCacheKey format exactly
-- ("year:2025" / "month:2026-09") rather than separate year/month columns
-- or a generated key — nothing here ever queries across periods, always
-- one exact row by its own key.
--
-- Purely additive — safe to run once.
-- ============================================================
create table if not exists public.recap_cache (
  user_id uuid not null references auth.users (id) on delete cascade,
  period_key text not null,
  payload jsonb not null,
  computed_at timestamptz not null default now(),
  primary key (user_id, period_key)
);

alter table public.recap_cache enable row level security;

create policy "Users manage their own recap cache"
  on public.recap_cache
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- Per-user opt-in to seeing "who among your following watched this" avatars
-- (episode detail's EpisodeWatchersRow and the show detail episode list's
-- inline avatar stack). Nullable, unlike show_feeling_prompt above — null
-- means "never asked," not "opted out," and is what both ask-once flows key
-- off: app/onboarding.tsx's watchActivity step for new accounts, and
-- components/WatchActivityPrompt.tsx (mounted once at the app root for an
-- existing session with session && !needsOnboarding) for everyone who
-- already had an account when this shipped. Both write an explicit
-- true/false the moment they're answered, so this column only ever reads
-- null for an account that hasn't been asked yet.
-- ============================================================
alter table public.user_settings
  add column if not exists show_watch_activity boolean;

-- ============================================================
-- Watch rooms — a small group you invite people into so that marking a
-- specific episode/movie watched can offer "also mark this watched for
-- [roommates]?" (see components/FeelingSheet.tsx's roommates prop and
-- components/RoommateShareRow.tsx). Deliberately NOT a blanket "everything
-- I watch is shared with this person" relationship — the share only ever
-- happens on explicit per-action confirmation, never automatically, so a
-- member can keep watching unrelated things solo without it leaking into
-- anyone else's list. Unlike `follows`, membership has no mutual-follow
-- precondition; a room is its own lightweight relationship.
-- ============================================================
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Null = no end date (permanent until deleted). Set once at creation from
  -- the create-room flow (no end date / in N days) and never recomputed
  -- afterward.
  expires_at timestamptz,
  -- Set independently of expires_at, via the create-room flow's optional
  -- "link to a show" search — powers the room detail screen's "Currently
  -- watching" section (see fetchLinkedShowProgress in lib/rooms.ts). Used to
  -- also drive expires_at (a room linked to an already-ended show expired
  -- the instant it was created, since its "latest known episode" air date
  -- was already in the past) — no longer does.
  linked_tvmaze_show_id int
);

create table public.room_members (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'accepted')),
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  primary key (room_id, user_id)
);

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;

-- A room_members SELECT policy that checks "is the caller a member of this
-- room" by querying room_members itself (a raw EXISTS subquery) recurses:
-- Postgres re-evaluates that same policy for the subquery's own scan of the
-- table, forever ("infinite recursion detected in policy for relation
-- room_members" — hit this live, SSH+psql against production, before
-- landing on this fix). A security definer function's body runs outside
-- the caller's RLS context, so the identical query inside it doesn't
-- re-trigger the policy that calls it. Both policies below (and any future
-- one needing "is this room, for this user" without the recursion problem)
-- should go through this rather than a direct room_members subquery.
create or replace function public.is_room_member(p_room_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.room_members rm where rm.room_id = p_room_id and rm.user_id = auth.uid());
$$;

create policy "Members see their rooms"
  on public.rooms
  for select
  using (auth.uid() = owner_id or public.is_room_member(id));

create policy "Users create rooms they own"
  on public.rooms
  for insert
  with check (auth.uid() = owner_id);

create policy "Owners update or delete their rooms"
  on public.rooms
  for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "Owners delete their rooms"
  on public.rooms
  for delete
  using (auth.uid() = owner_id);

create policy "Members see their room's membership"
  on public.room_members
  for select
  using (auth.uid() = user_id or public.is_room_member(room_id));

create policy "Owners invite into their rooms"
  on public.room_members
  for insert
  with check (auth.uid() = (select owner_id from public.rooms r where r.id = room_id));

create policy "Members accept their own invite"
  on public.room_members
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Members leave or owners remove members"
  on public.room_members
  for delete
  using (
    auth.uid() = user_id
    or auth.uid() = (select owner_id from public.rooms r where r.id = room_id)
  );

-- The owner is a full (accepted) member from the start, not just the row
-- that owns the room — fetchAcceptedRoommatesCached() and the propagation
-- RPCs below both key off room_members, so without this the creator's own
-- episodes would never see a "share with room" option in their own room.
create or replace function public.room_owner_auto_join()
returns trigger as $$
begin
  insert into public.room_members (room_id, user_id, status, joined_at)
  values (new.id, new.owner_id, 'accepted', now());
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger rooms_owner_auto_join
  after insert on public.rooms
  for each row
  execute function public.room_owner_auto_join();

-- Room invites ride the existing notifications table rather than a new one
-- — room_id/room_name mirror the existing tvmaze_show_id/show_name columns,
-- which are already null for every notification type except stale_watchlist.
alter table public.notifications
  add column if not exists room_id uuid references public.rooms (id) on delete cascade,
  add column if not exists room_name text;

create or replace function public.notify_on_room_invite()
returns trigger as $$
begin
  if new.status = 'invited' then
    insert into public.notifications (user_id, type, actor_id, room_id, room_name)
    select new.user_id, 'room_invite', r.owner_id, r.id, r.name
    from public.rooms r
    where r.id = new.room_id;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger room_members_notify
  after insert on public.room_members
  for each row
  execute function public.notify_on_room_invite();

-- One row per (room, content) a share actually touched — not per target
-- member, since "this room watched episode X together" is the room-level
-- fact app/rooms/[id].tsx's "Watched together" section wants, regardless of
-- how many of that room's members were checked in the share dialog.
-- Episode/movie display names aren't stored here (unlike user_movies, which
-- already keeps its own title/year/poster_path) — episodes are resolved
-- client-side through the existing shared show cache (getCachedShow) when
-- grouping the log by show for display, the same data every other screen
-- already fetches, so there's nothing new to keep in sync by duplicating it
-- here.
create table public.room_watch_log (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  shared_by uuid not null references auth.users (id) on delete cascade,
  content_type text not null check (content_type in ('episode', 'movie')),
  tvmaze_show_id int,
  tvmaze_episode_id int,
  season int,
  number int,
  tmdb_id int,
  movie_title text,
  movie_year int,
  movie_poster_path text,
  created_at timestamptz not null default now()
);

alter table public.room_watch_log enable row level security;

create policy "Members see their room's watch log"
  on public.room_watch_log
  for select
  using (public.is_room_member(room_id));

-- No insert policy for regular users — rows only ever come from the two
-- security definer RPCs below, same convention as public.notifications.

-- Propagation — only ever called from the explicit "share with room"
-- confirm (never a trigger/automatic), and re-validates membership itself
-- so a client can't pass an arbitrary target id: p_target_user_ids is
-- intersected with the caller's own accepted, non-expired room-mates
-- server-side regardless of what's passed in.
create or replace function public.mark_episode_watched_for_room(
  p_target_user_ids uuid[],
  p_tvmaze_show_id int,
  p_tvmaze_episode_id int,
  p_season int,
  p_number int
) returns void language plpgsql security definer set search_path = public as $$
begin
  -- distinct: a target who shares more than one room with the caller (the
  -- whole point of the room-based picker now letting several rooms be
  -- checked at once — see components/RoomSharePicker.tsx) otherwise
  -- matches this join once per shared room, handing the INSERT the same
  -- (user_id, tvmaze_episode_id) twice — which ON CONFLICT DO UPDATE
  -- rejects outright ("cannot affect row a second time"), found live the
  -- first time a real multi-room share actually happened.
  insert into public.watched_episodes (user_id, tvmaze_show_id, tvmaze_episode_id, season, number, watched)
  select distinct rm2.user_id, p_tvmaze_show_id, p_tvmaze_episode_id, p_season, p_number, true
  from public.room_members rm1
  join public.room_members rm2 on rm1.room_id = rm2.room_id
  join public.rooms r on r.id = rm1.room_id
  where rm1.user_id = auth.uid() and rm1.status = 'accepted' and rm2.status = 'accepted'
    and (r.expires_at is null or r.expires_at > now())
    and rm2.user_id = any(p_target_user_ids) and rm2.user_id != auth.uid()
  on conflict (user_id, tvmaze_episode_id) do update set watched = true, watched_at = now();

  insert into public.room_watch_log (room_id, shared_by, content_type, tvmaze_show_id, tvmaze_episode_id, season, number)
  select distinct rm1.room_id, auth.uid(), 'episode', p_tvmaze_show_id, p_tvmaze_episode_id, p_season, p_number
  from public.room_members rm1
  join public.room_members rm2 on rm1.room_id = rm2.room_id
  join public.rooms r on r.id = rm1.room_id
  where rm1.user_id = auth.uid() and rm1.status = 'accepted' and rm2.status = 'accepted'
    and (r.expires_at is null or r.expires_at > now())
    and rm2.user_id = any(p_target_user_ids) and rm2.user_id != auth.uid();
end;
$$;

create or replace function public.mark_movie_watched_for_room(
  p_target_user_ids uuid[],
  p_tmdb_id int,
  p_title text,
  p_year int,
  p_poster_path text
) returns void language plpgsql security definer set search_path = public as $$
begin
  -- distinct: same reasoning as mark_episode_watched_for_room above — a
  -- target in more than one of the caller's shared rooms must only ever
  -- appear once in this INSERT's rows.
  insert into public.user_movies (user_id, tmdb_id, title, year, poster_path, status, watched_at)
  select distinct rm2.user_id, p_tmdb_id, p_title, p_year, p_poster_path, 'watched', now()
  from public.room_members rm1
  join public.room_members rm2 on rm1.room_id = rm2.room_id
  join public.rooms r on r.id = rm1.room_id
  where rm1.user_id = auth.uid() and rm1.status = 'accepted' and rm2.status = 'accepted'
    and (r.expires_at is null or r.expires_at > now())
    and rm2.user_id = any(p_target_user_ids) and rm2.user_id != auth.uid()
  on conflict (user_id, title, year) do update set status = 'watched', watched_at = now();

  insert into public.room_watch_log (room_id, shared_by, content_type, tmdb_id, movie_title, movie_year, movie_poster_path)
  select distinct rm1.room_id, auth.uid(), 'movie', p_tmdb_id, p_title, p_year, p_poster_path
  from public.room_members rm1
  join public.room_members rm2 on rm1.room_id = rm2.room_id
  join public.rooms r on r.id = rm1.room_id
  where rm1.user_id = auth.uid() and rm1.status = 'accepted' and rm2.status = 'accepted'
    and (r.expires_at is null or r.expires_at > now())
    and rm2.user_id = any(p_target_user_ids) and rm2.user_id != auth.uid();
end;
$$;

-- ============================================================
-- Four room improvements, all additive:
--
-- 1. A room gets an optional single-character emoji (picked from a small
--    curated set client-side, see components/RoomSharePicker.tsx and
--    app/rooms/index.tsx) so it has some visual identity beyond its name —
--    falls back to the name's first letter when unset, same as a person's
--    Avatar does for no photo.
--
-- 2. notify_on_room_watch_log fires a notification to every OTHER accepted
--    member of a room whenever a room_watch_log row lands — reusing that
--    table (rather than teaching the RPCs to also write notifications
--    directly) means every share, from either RPC below or the new batched
--    one, notifies for free. room_watch_log_id lets the notification screen
--    resolve exactly what was shared without duplicating show/episode/movie
--    columns onto notifications itself.
--
-- 3. mark_episodes_watched_for_room is mark_episode_watched_for_room's
--    batched sibling — a season-level "mark all watched" shouldn't cost one
--    network round trip (and one popup) per episode. p_episodes is a jsonb
--    array of {id, season, number} objects rather than three parallel
--    arrays, both because Postgres has no array-of-row literal that's
--    pleasant to build from JS and because it reads directly as the shape
--    the client already has each episode in.
-- ============================================================
alter table public.rooms add column if not exists emoji text;

alter table public.notifications
  add column if not exists room_watch_log_id uuid references public.room_watch_log (id) on delete cascade;

-- Statement-level (not row-level) — a season shared in one go lands as N
-- room_watch_log rows from a single INSERT (see mark_episodes_watched_for_
-- room's cross join below), and a row-level trigger fired once per episode,
-- which meant a 13-episode season produced 13 separate notifications to
-- the same person for the same action. Grouping by (room, sharer, show,
-- season) within the statement's new rows collapses that into one
-- notification per actual share action — a single episode (or a movie,
-- which has no season) just forms its own group of one, so this needs no
-- separate code path for the non-batched RPCs.
alter table public.notifications
  add column if not exists room_watch_episode_count int not null default 1;

create or replace function public.notify_on_room_watch_log()
returns trigger as $$
begin
  insert into public.notifications (user_id, type, actor_id, room_id, room_name, room_watch_log_id, room_watch_episode_count)
  select rm.user_id, 'room_share', g.shared_by, g.room_id, r.name, g.rep_id, g.episode_count
  from (
    -- min(id::text)::uuid, not min(id) — Postgres has no built-in min/max
    -- aggregate for uuid (found live: "function min(uuid) does not exist").
    select room_id, shared_by, min(id::text)::uuid as rep_id, count(*) as episode_count
    from new_table
    where content_type = 'episode' and season is not null
    group by room_id, shared_by, tvmaze_show_id, season
    union all
    select room_id, shared_by, id as rep_id, 1 as episode_count
    from new_table
    where not (content_type = 'episode' and season is not null)
  ) g
  join public.rooms r on r.id = g.room_id
  join public.room_members rm on rm.room_id = g.room_id
  where rm.status = 'accepted' and rm.user_id != g.shared_by;
  return null;
end;
$$ language plpgsql security definer set search_path = public;

create trigger room_watch_log_notify
  after insert on public.room_watch_log
  referencing new table as new_table
  for each statement
  execute function public.notify_on_room_watch_log();

create or replace function public.mark_episodes_watched_for_room(
  p_target_user_ids uuid[],
  p_tvmaze_show_id int,
  p_episodes jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.watched_episodes (user_id, tvmaze_show_id, tvmaze_episode_id, season, number, watched)
  select distinct rm2.user_id, p_tvmaze_show_id, (e->>'id')::int, (e->>'season')::int, (e->>'number')::int, true
  from public.room_members rm1
  join public.room_members rm2 on rm1.room_id = rm2.room_id
  join public.rooms r on r.id = rm1.room_id
  cross join jsonb_array_elements(p_episodes) as e
  where rm1.user_id = auth.uid() and rm1.status = 'accepted' and rm2.status = 'accepted'
    and (r.expires_at is null or r.expires_at > now())
    and rm2.user_id = any(p_target_user_ids) and rm2.user_id != auth.uid()
  on conflict (user_id, tvmaze_episode_id) do update set watched = true, watched_at = now();

  insert into public.room_watch_log (room_id, shared_by, content_type, tvmaze_show_id, tvmaze_episode_id, season, number)
  select distinct rm1.room_id, auth.uid(), 'episode', p_tvmaze_show_id, (e->>'id')::int, (e->>'season')::int, (e->>'number')::int
  from public.room_members rm1
  join public.room_members rm2 on rm1.room_id = rm2.room_id
  join public.rooms r on r.id = rm1.room_id
  cross join jsonb_array_elements(p_episodes) as e
  where rm1.user_id = auth.uid() and rm1.status = 'accepted' and rm2.status = 'accepted'
    and (r.expires_at is null or r.expires_at > now())
    and rm2.user_id = any(p_target_user_ids) and rm2.user_id != auth.uid();
end;
$$;

-- ============================================================
-- Room-scoped propagation — the three RPCs above inferred "which room is
-- this share for" purely from p_target_user_ids: any room where both
-- caller and target are accepted members. That's wrong the moment two
-- people share more than one room — picking only one of those rooms in
-- components/RoomSharePicker.tsx still wrote to every room they have in
-- common, since the target id alone can't tell the RPC which one was
-- actually selected. Adding p_room_ids (the exact rooms picked
-- client-side) and requiring rm1.room_id = any(p_room_ids) fixes that
-- scoping. Surfaced while building a room-detail "add directly to this
-- room" entry point (app/rooms/[id].tsx) — a flow that, by construction,
-- only ever means one specific room, which made the old inference-based
-- scoping actively wrong rather than just imprecise.
-- ============================================================
drop function if exists public.mark_episode_watched_for_room(uuid[], int, int, int, int);
drop function if exists public.mark_movie_watched_for_room(uuid[], int, text, int, text);
drop function if exists public.mark_episodes_watched_for_room(uuid[], int, jsonb);

create or replace function public.mark_episode_watched_for_room(
  p_room_ids uuid[],
  p_target_user_ids uuid[],
  p_tvmaze_show_id int,
  p_tvmaze_episode_id int,
  p_season int,
  p_number int
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.watched_episodes (user_id, tvmaze_show_id, tvmaze_episode_id, season, number, watched)
  select distinct rm2.user_id, p_tvmaze_show_id, p_tvmaze_episode_id, p_season, p_number, true
  from public.room_members rm1
  join public.room_members rm2 on rm1.room_id = rm2.room_id
  join public.rooms r on r.id = rm1.room_id
  where rm1.user_id = auth.uid() and rm1.status = 'accepted' and rm2.status = 'accepted'
    and rm1.room_id = any(p_room_ids)
    and (r.expires_at is null or r.expires_at > now())
    and rm2.user_id = any(p_target_user_ids) and rm2.user_id != auth.uid()
  on conflict (user_id, tvmaze_episode_id) do update set watched = true, watched_at = now();

  insert into public.room_watch_log (room_id, shared_by, content_type, tvmaze_show_id, tvmaze_episode_id, season, number)
  select distinct rm1.room_id, auth.uid(), 'episode', p_tvmaze_show_id, p_tvmaze_episode_id, p_season, p_number
  from public.room_members rm1
  join public.room_members rm2 on rm1.room_id = rm2.room_id
  join public.rooms r on r.id = rm1.room_id
  where rm1.user_id = auth.uid() and rm1.status = 'accepted' and rm2.status = 'accepted'
    and rm1.room_id = any(p_room_ids)
    and (r.expires_at is null or r.expires_at > now())
    and rm2.user_id = any(p_target_user_ids) and rm2.user_id != auth.uid();
end;
$$;

create or replace function public.mark_movie_watched_for_room(
  p_room_ids uuid[],
  p_target_user_ids uuid[],
  p_tmdb_id int,
  p_title text,
  p_year int,
  p_poster_path text
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_movies (user_id, tmdb_id, title, year, poster_path, status, watched_at)
  select distinct rm2.user_id, p_tmdb_id, p_title, p_year, p_poster_path, 'watched', now()
  from public.room_members rm1
  join public.room_members rm2 on rm1.room_id = rm2.room_id
  join public.rooms r on r.id = rm1.room_id
  where rm1.user_id = auth.uid() and rm1.status = 'accepted' and rm2.status = 'accepted'
    and rm1.room_id = any(p_room_ids)
    and (r.expires_at is null or r.expires_at > now())
    and rm2.user_id = any(p_target_user_ids) and rm2.user_id != auth.uid()
  on conflict (user_id, title, year) do update set status = 'watched', watched_at = now();

  insert into public.room_watch_log (room_id, shared_by, content_type, tmdb_id, movie_title, movie_year, movie_poster_path)
  select distinct rm1.room_id, auth.uid(), 'movie', p_tmdb_id, p_title, p_year, p_poster_path
  from public.room_members rm1
  join public.room_members rm2 on rm1.room_id = rm2.room_id
  join public.rooms r on r.id = rm1.room_id
  where rm1.user_id = auth.uid() and rm1.status = 'accepted' and rm2.status = 'accepted'
    and rm1.room_id = any(p_room_ids)
    and (r.expires_at is null or r.expires_at > now())
    and rm2.user_id = any(p_target_user_ids) and rm2.user_id != auth.uid();
end;
$$;

create or replace function public.mark_episodes_watched_for_room(
  p_room_ids uuid[],
  p_target_user_ids uuid[],
  p_tvmaze_show_id int,
  p_episodes jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.watched_episodes (user_id, tvmaze_show_id, tvmaze_episode_id, season, number, watched)
  select distinct rm2.user_id, p_tvmaze_show_id, (e->>'id')::int, (e->>'season')::int, (e->>'number')::int, true
  from public.room_members rm1
  join public.room_members rm2 on rm1.room_id = rm2.room_id
  join public.rooms r on r.id = rm1.room_id
  cross join jsonb_array_elements(p_episodes) as e
  where rm1.user_id = auth.uid() and rm1.status = 'accepted' and rm2.status = 'accepted'
    and rm1.room_id = any(p_room_ids)
    and (r.expires_at is null or r.expires_at > now())
    and rm2.user_id = any(p_target_user_ids) and rm2.user_id != auth.uid()
  on conflict (user_id, tvmaze_episode_id) do update set watched = true, watched_at = now();

  insert into public.room_watch_log (room_id, shared_by, content_type, tvmaze_show_id, tvmaze_episode_id, season, number)
  select distinct rm1.room_id, auth.uid(), 'episode', p_tvmaze_show_id, (e->>'id')::int, (e->>'season')::int, (e->>'number')::int
  from public.room_members rm1
  join public.room_members rm2 on rm1.room_id = rm2.room_id
  join public.rooms r on r.id = rm1.room_id
  cross join jsonb_array_elements(p_episodes) as e
  where rm1.user_id = auth.uid() and rm1.status = 'accepted' and rm2.status = 'accepted'
    and rm1.room_id = any(p_room_ids)
    and (r.expires_at is null or r.expires_at > now())
    and rm2.user_id = any(p_target_user_ids) and rm2.user_id != auth.uid();
end;
$$;

-- ============================================================
-- General report (not tied to a show/movie/user/comment) + admin replies
-- to the reporter. Purely additive — safe to run once against an existing
-- database.
-- ============================================================

-- A problem that isn't about any specific piece of content (e.g. "search is
-- broken") had nowhere to go before — every target_* column on reports was
-- always null for these, same sparse-column convention the others use.
alter type report_target add value if not exists 'general';

-- resolution_note (see public.reports above) is deliberately never shown to
-- the reporter — admins wanted a second, explicitly-reporter-facing field
-- to actually tell someone "fixed" or "can't reproduce," instead of
-- repurposing the internal-only note. One reply per report (overwritten by
-- a later one, not a thread) is enough for what this is actually used for.
alter table public.reports add column if not exists admin_reply text;
alter table public.reports add column if not exists admin_reply_at timestamptz;

-- Replies ride the existing notifications table, same convention room_id/
-- room_name (see notify_on_room_invite above) already established.
alter table public.notifications
  add column if not exists report_id uuid references public.reports (id) on delete cascade,
  add column if not exists report_message text;

-- security definer so a client can't insert into someone else's
-- notifications directly (no insert policy exists for that — see
-- public.notifications above) — this is the one controlled path in,
-- gated on the same is_admin check the "Admins update reports" RLS policy
-- already uses.
create or replace function public.send_report_reply(p_report_id uuid, p_message text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_reporter_id uuid;
begin
  if not exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;

  select reporter_id into v_reporter_id from public.reports where id = p_report_id;
  if v_reporter_id is null then
    raise exception 'report not found';
  end if;

  update public.reports set admin_reply = p_message, admin_reply_at = now() where id = p_report_id;

  insert into public.notifications (user_id, type, actor_id, report_id, report_message)
  values (v_reporter_id, 'report_response', auth.uid(), p_report_id, p_message);
end;
$$;

grant execute on function public.send_report_reply(uuid, text) to authenticated;

-- ============================================================
-- Shared, cross-user cache of TMDB TV id -> resolved TVmaze show (see
-- findTvmazeShowFromTmdbTv in lib/tmdb.ts). Unlike tmdb_api_cache/
-- tvmaze_api_cache above, this has no TTL — a TMDB show's matching TVmaze
-- show is a fixed identity that doesn't change once resolved, so there's
-- nothing to go stale. Explore's discover-category cards (app/(tabs)/
-- explore.tsx) batch-read this in one request for everything on screen
-- before falling back to the normal chained TMDB-external-ids + TVmaze-
-- lookup resolution one card at a time — that chain is still correct, just
-- noticeably slower done per-card across 40-80 cards at once, which is
-- what made "is this already in my list" visibly lag behind on Explore's
-- first load compared to a user profile (whose shows are already stored by
-- TVmaze id directly, no resolution needed at all). "View more" (app/
-- browse.tsx) and Explore's own text search deliberately keep resolving
-- live instead of reading this table — their result sets are large/
-- dynamic, not the same small fixed set of discover-category cards every
-- user sees — but every successful resolution anywhere (including those
-- two) still writes through here for next time.
--
-- Same RLS shape as tvmaze_api_cache: any authenticated user can read, and
-- can also write a resolution their own session just computed — the data
-- is a public mapping with no injection/abuse surface worth locking down
-- further (worst case a bad write is one wrong row, overwritten by the
-- next real resolution).
--
-- Purely additive — safe to run once.
-- ============================================================
create table if not exists public.tmdb_tvmaze_resolved (
  tmdb_tv_id integer primary key,
  tvmaze_show jsonb not null,
  resolved_at timestamptz not null default now()
);

alter table public.tmdb_tvmaze_resolved enable row level security;

create policy "tmdb_tvmaze_resolved_select_authenticated"
  on public.tmdb_tvmaze_resolved for select
  using (auth.role() = 'authenticated');

create policy "tmdb_tvmaze_resolved_upsert_authenticated"
  on public.tmdb_tvmaze_resolved for insert
  with check (auth.role() = 'authenticated');

create policy "tmdb_tvmaze_resolved_update_authenticated"
  on public.tmdb_tvmaze_resolved for update
  using (auth.role() = 'authenticated');

-- ============================================================
-- Room watchlist — "we want to watch this together" (not yet started, not
-- an episode-level log like room_watch_log above). Lets a room build up a
-- shared queue of shows/movies members intend to watch together, distinct
-- from both room_watch_log (what's already been watched) and rooms.
-- linked_tvmaze_show_id (a single show the room is explicitly tracking
-- progress on). Purely additive — safe to run once.
-- ============================================================
create table if not exists public.room_watchlist (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  added_by uuid not null references auth.users (id) on delete cascade,
  content_type text not null check (content_type in ('show', 'movie')),
  tvmaze_show_id integer,
  tmdb_id integer,
  title text not null,
  image_url text,
  created_at timestamptz not null default now()
);

alter table public.room_watchlist enable row level security;

create policy "Members view their room's watchlist"
  on public.room_watchlist
  for select
  using (public.is_room_member(room_id));

create policy "Accepted members add to their room's watchlist"
  on public.room_watchlist
  for insert
  with check (
    auth.uid() = added_by
    and exists (
      select 1 from public.room_members rm
      where rm.room_id = room_watchlist.room_id and rm.user_id = auth.uid() and rm.status = 'accepted'
    )
  );

-- Whoever added an entry can take it back off, same as the owner managing
-- anything else in their room.
create policy "Adder or owner removes a watchlist entry"
  on public.room_watchlist
  for delete
  using (
    auth.uid() = added_by
    or auth.uid() = (select owner_id from public.rooms r where r.id = room_id)
  );

-- Partial, not a plain unique(room_id, tvmaze_show_id, tmdb_id) — the two
-- id columns are only ever one-set-one-null depending on content_type, and
-- a plain multi-column unique constraint doesn't dedupe nulls (NULL is
-- never equal to NULL), so two movies would never have actually conflicted
-- on a bare (room_id, tvmaze_show_id, tmdb_id) constraint.
create unique index if not exists room_watchlist_show_unique
  on public.room_watchlist (room_id, tvmaze_show_id) where content_type = 'show';
create unique index if not exists room_watchlist_movie_unique
  on public.room_watchlist (room_id, tmdb_id) where content_type = 'movie';

-- ============================================================
-- Clear a room_invite notification the moment the underlying invite is
-- resolved, regardless of which screen resolved it (app/rooms/index.tsx's
-- own accept/decline, app/notifications.tsx's, or a future third one) —
-- a single trigger here instead of duplicating "also delete the
-- notification" in every client call site, which is exactly what let this
-- drift: accepting from the Rooms list left the notification itself
-- untouched server-side, so it reappeared on the next fetch even though
-- the room_members row really was 'accepted'. Purely additive — safe to
-- run once.
-- ============================================================
create or replace function public.clear_room_invite_notification()
returns trigger as $$
begin
  if TG_OP = 'UPDATE' and OLD.status = 'invited' and NEW.status = 'accepted' then
    delete from public.notifications
    where type = 'room_invite' and room_id = NEW.room_id and user_id = NEW.user_id;
  elsif TG_OP = 'DELETE' and OLD.status = 'invited' then
    -- A decline (lib/rooms.ts's declineRoomInvite deletes the row outright)
    -- — not every room_members delete is a decline (leaving an already-
    -- accepted room, or the owner removing a member, both delete too), so
    -- this only fires for a row that was still pending.
    delete from public.notifications
    where type = 'room_invite' and room_id = OLD.room_id and user_id = OLD.user_id;
  end if;
  return coalesce(NEW, OLD);
end;
$$ language plpgsql security definer set search_path = public;

create trigger room_members_clear_invite_notification
  after update or delete on public.room_members
  for each row
  execute function public.clear_room_invite_notification();

-- ============================================================
-- Fixes every file upload in the app (report photos, avatars — anything
-- going through supabase.storage) failing with a raw Postgres "permission
-- denied for table buckets"/"for table objects" (confirmed live via a
-- captured network response, not a guess). storage.buckets and storage.
-- objects are owned by supabase_storage_admin, and on this instance had
-- NO grants at all to anon/authenticated/service_role — not even SELECT —
-- so every storage-api request made on a logged-in user's behalf (which
-- runs as one of those roles, not the table owner) was rejected before
-- the RLS policies below it (e.g. "Report images are publicly readable",
-- "Users upload their own report images") ever got a chance to evaluate.
-- This restores the standard Supabase baseline grant; RLS stays the real
-- access boundary exactly as already configured.
--
-- Must run as a true superuser (supabase_admin on this instance) — running
-- it as the `postgres` role itself silently no-ops ("WARNING: no
-- privileges were granted") because postgres holds these same privileges
-- without GRANT OPTION, so it can't re-grant them to anyone else; hit this
-- live before switching to supabase_admin. Purely additive — safe to run
-- once.
-- ============================================================
grant select, insert, update, delete on storage.buckets to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;

-- ============================================================
-- Adding something to a room's watchlist (public.room_watchlist above)
-- also queues it on every accepted member's own personal watchlist —
-- "want to watch together" should actually show up where each person
-- already tracks what they want to watch, not just inside the room. Does
-- nothing to a member who already has this show/movie in their list in
-- ANY status (including already watched) — "on conflict do nothing", not
-- an upsert, specifically so this can never silently reset someone's
-- already-watched movie back to want_to_watch.
-- ============================================================
create or replace function public.add_show_to_watchlist_for_room(
  p_room_id uuid, p_tvmaze_show_id int, p_show_name text, p_show_image text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.room_members me
    where me.room_id = p_room_id and me.user_id = auth.uid() and me.status = 'accepted'
  ) then
    raise exception 'not a member of this room';
  end if;

  insert into public.user_shows (user_id, tvmaze_id, show_name, show_image, status)
  select rm.user_id, p_tvmaze_show_id, p_show_name, p_show_image, 'want_to_watch'
  from public.room_members rm
  where rm.room_id = p_room_id and rm.status = 'accepted'
  on conflict (user_id, tvmaze_id) do nothing;
end;
$$;

create or replace function public.add_movie_to_watchlist_for_room(
  p_room_id uuid, p_tmdb_id int, p_title text, p_year int, p_poster_path text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.room_members me
    where me.room_id = p_room_id and me.user_id = auth.uid() and me.status = 'accepted'
  ) then
    raise exception 'not a member of this room';
  end if;

  insert into public.user_movies (user_id, tmdb_id, title, year, poster_path, status, watched_at, times_watched)
  select rm.user_id, p_tmdb_id, p_title, p_year, p_poster_path, 'want_to_watch', null, 0
  from public.room_members rm
  where rm.room_id = p_room_id and rm.status = 'accepted'
  on conflict (user_id, title, year) do nothing;
end;
$$;

grant execute on function public.add_show_to_watchlist_for_room(uuid, int, text, text) to authenticated;
grant execute on function public.add_movie_to_watchlist_for_room(uuid, int, text, int, text) to authenticated;

-- ============================================================
-- Undo a "watched together" share — in case a room member tapped it by
-- mistake. Reverses mark_episode(s)_watched_for_room/mark_movie_watched_
-- for_room's effect: deletes the matching room_watch_log rows for this
-- room+show/movie (all of them, not just the latest one — the room page
-- groups by show/movie, so "undo" at that granularity means the whole
-- group) and un-marks those specific episodes/that movie as watched for
-- every currently-accepted room member, same membership bar as creating
-- the share in the first place (any accepted member, not just the owner
-- or original sharer — this is meant as an easy "oops, undo that" safety
-- net, not a moderation action).
-- ============================================================
create or replace function public.unmark_episodes_watched_for_room(
  p_room_id uuid, p_tvmaze_show_id int
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_episode_ids int[];
begin
  if not exists (
    select 1 from public.room_members me
    where me.room_id = p_room_id and me.user_id = auth.uid() and me.status = 'accepted'
  ) then
    raise exception 'not a member of this room';
  end if;

  select array_agg(distinct tvmaze_episode_id) into v_episode_ids
  from public.room_watch_log
  where room_id = p_room_id and content_type = 'episode' and tvmaze_show_id = p_tvmaze_show_id;

  if v_episode_ids is null then
    return;
  end if;

  delete from public.watched_episodes
  where tvmaze_episode_id = any(v_episode_ids)
    and user_id in (select rm.user_id from public.room_members rm where rm.room_id = p_room_id and rm.status = 'accepted');

  delete from public.room_watch_log
  where room_id = p_room_id and content_type = 'episode' and tvmaze_show_id = p_tvmaze_show_id;
end;
$$;

create or replace function public.unmark_movie_watched_for_room(
  p_room_id uuid, p_tmdb_id int
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.room_members me
    where me.room_id = p_room_id and me.user_id = auth.uid() and me.status = 'accepted'
  ) then
    raise exception 'not a member of this room';
  end if;

  delete from public.user_movies
  where tmdb_id = p_tmdb_id
    and user_id in (select rm.user_id from public.room_members rm where rm.room_id = p_room_id and rm.status = 'accepted');

  delete from public.room_watch_log
  where room_id = p_room_id and content_type = 'movie' and tmdb_id = p_tmdb_id;
end;
$$;

grant execute on function public.unmark_episodes_watched_for_room(uuid, int) to authenticated;
grant execute on function public.unmark_movie_watched_for_room(uuid, int) to authenticated;

-- ============================================================
-- Rewatching an episode together, when a target member already has it
-- marked watched, now asks them to confirm first instead of silently
-- bumping their count — a notification with Yes/No (room_rewatch_confirm),
-- resolved by confirm_room_rewatch below. A target who *doesn't* already
-- have the episode watched is unaffected: marked watched immediately, same
-- as before. Scoped to episodes only (not movies) — mark_movie_watched_
-- for_room's existing x2/x3 "Watched together" count stays direct-increment.
--
-- NOTE on applying this: mark_episode_watched_for_room/mark_episodes_
-- watched_for_room below are CREATE OR REPLACE of functions that already
-- existed, owned by supabase_storage_admin's sibling supabase_admin (not
-- postgres) on this instance — same "must be owner" issue the storage
-- grants fix above hit. Run those two specifically as supabase_admin, not
-- postgres; everything else here (new table/columns/functions) postgres
-- owns fine since it's creating them fresh.
-- ============================================================
create table if not exists public.room_rewatch_confirmations (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  requested_by uuid not null references auth.users (id) on delete cascade,
  tvmaze_show_id integer not null,
  tvmaze_episode_id integer not null,
  season integer not null,
  number integer not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'declined')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.room_rewatch_confirmations enable row level security;

create policy "Users see their own rewatch confirmations"
  on public.room_rewatch_confirmations
  for select
  using (auth.uid() = user_id or auth.uid() = requested_by);

alter table public.notifications
  add column if not exists rewatch_confirmation_id uuid references public.room_rewatch_confirmations (id) on delete cascade,
  add column if not exists rewatch_season integer,
  add column if not exists rewatch_number integer;

create or replace function public.mark_episode_watched_for_room(
  p_room_ids uuid[],
  p_target_user_ids uuid[],
  p_tvmaze_show_id int,
  p_tvmaze_episode_id int,
  p_season int,
  p_number int
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_pair record;
  v_confirmation_id uuid;
begin
  insert into public.room_watch_log (room_id, shared_by, content_type, tvmaze_show_id, tvmaze_episode_id, season, number)
  select distinct rm1.room_id, auth.uid(), 'episode', p_tvmaze_show_id, p_tvmaze_episode_id, p_season, p_number
  from public.room_members rm1
  join public.room_members rm2 on rm1.room_id = rm2.room_id
  join public.rooms r on r.id = rm1.room_id
  where rm1.user_id = auth.uid() and rm1.status = 'accepted' and rm2.status = 'accepted'
    and rm1.room_id = any(p_room_ids)
    and (r.expires_at is null or r.expires_at > now())
    and rm2.user_id = any(p_target_user_ids) and rm2.user_id != auth.uid();

  create temporary table _already_watched on commit drop as
  select we.user_id from public.watched_episodes we
  where we.tvmaze_episode_id = p_tvmaze_episode_id and we.watched;

  for v_pair in
    select distinct rm1.room_id, rm2.user_id
    from public.room_members rm1
    join public.room_members rm2 on rm1.room_id = rm2.room_id
    join public.rooms r on r.id = rm1.room_id
    where rm1.user_id = auth.uid() and rm1.status = 'accepted' and rm2.status = 'accepted'
      and rm1.room_id = any(p_room_ids)
      and (r.expires_at is null or r.expires_at > now())
      and rm2.user_id = any(p_target_user_ids) and rm2.user_id != auth.uid()
  loop
    if exists (select 1 from _already_watched aw where aw.user_id = v_pair.user_id) then
      insert into public.room_rewatch_confirmations (room_id, user_id, requested_by, tvmaze_show_id, tvmaze_episode_id, season, number)
      values (v_pair.room_id, v_pair.user_id, auth.uid(), p_tvmaze_show_id, p_tvmaze_episode_id, p_season, p_number)
      returning id into v_confirmation_id;

      insert into public.notifications (user_id, type, actor_id, room_id, rewatch_confirmation_id, tvmaze_show_id, rewatch_season, rewatch_number)
      values (v_pair.user_id, 'room_rewatch_confirm', auth.uid(), v_pair.room_id, v_confirmation_id, p_tvmaze_show_id, p_season, p_number);
    else
      insert into public.watched_episodes (user_id, tvmaze_show_id, tvmaze_episode_id, season, number, watched)
      values (v_pair.user_id, p_tvmaze_show_id, p_tvmaze_episode_id, p_season, p_number, true)
      on conflict (user_id, tvmaze_episode_id) do update set watched = true, watched_at = now();
    end if;
  end loop;
end;
$$;

create or replace function public.mark_episodes_watched_for_room(
  p_room_ids uuid[],
  p_target_user_ids uuid[],
  p_tvmaze_show_id int,
  p_episodes jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_pair record;
  v_episode record;
  v_confirmation_id uuid;
begin
  insert into public.room_watch_log (room_id, shared_by, content_type, tvmaze_show_id, tvmaze_episode_id, season, number)
  select distinct rm1.room_id, auth.uid(), 'episode', p_tvmaze_show_id, (e->>'id')::int, (e->>'season')::int, (e->>'number')::int
  from public.room_members rm1
  join public.room_members rm2 on rm1.room_id = rm2.room_id
  join public.rooms r on r.id = rm1.room_id
  cross join jsonb_array_elements(p_episodes) as e
  where rm1.user_id = auth.uid() and rm1.status = 'accepted' and rm2.status = 'accepted'
    and rm1.room_id = any(p_room_ids)
    and (r.expires_at is null or r.expires_at > now())
    and rm2.user_id = any(p_target_user_ids) and rm2.user_id != auth.uid();

  create temporary table _already_watched_batch on commit drop as
  select we.user_id, we.tvmaze_episode_id from public.watched_episodes we
  where we.watched and we.tvmaze_episode_id in (
    select (e->>'id')::int from jsonb_array_elements(p_episodes) as e
  );

  for v_pair in
    select distinct rm1.room_id, rm2.user_id
    from public.room_members rm1
    join public.room_members rm2 on rm1.room_id = rm2.room_id
    join public.rooms r on r.id = rm1.room_id
    where rm1.user_id = auth.uid() and rm1.status = 'accepted' and rm2.status = 'accepted'
      and rm1.room_id = any(p_room_ids)
      and (r.expires_at is null or r.expires_at > now())
      and rm2.user_id = any(p_target_user_ids) and rm2.user_id != auth.uid()
  loop
    for v_episode in select e from jsonb_array_elements(p_episodes) as e loop
      if exists (
        select 1 from _already_watched_batch aw
        where aw.user_id = v_pair.user_id and aw.tvmaze_episode_id = (v_episode.e->>'id')::int
      ) then
        insert into public.room_rewatch_confirmations (room_id, user_id, requested_by, tvmaze_show_id, tvmaze_episode_id, season, number)
        values (
          v_pair.room_id, v_pair.user_id, auth.uid(), p_tvmaze_show_id,
          (v_episode.e->>'id')::int, (v_episode.e->>'season')::int, (v_episode.e->>'number')::int
        )
        returning id into v_confirmation_id;

        insert into public.notifications (user_id, type, actor_id, room_id, rewatch_confirmation_id, tvmaze_show_id, rewatch_season, rewatch_number)
        values (
          v_pair.user_id, 'room_rewatch_confirm', auth.uid(), v_pair.room_id, v_confirmation_id,
          p_tvmaze_show_id, (v_episode.e->>'season')::int, (v_episode.e->>'number')::int
        );
      else
        insert into public.watched_episodes (user_id, tvmaze_show_id, tvmaze_episode_id, season, number, watched)
        values (
          v_pair.user_id, p_tvmaze_show_id, (v_episode.e->>'id')::int,
          (v_episode.e->>'season')::int, (v_episode.e->>'number')::int, true
        )
        on conflict (user_id, tvmaze_episode_id) do update set watched = true, watched_at = now();
      end if;
    end loop;
  end loop;
end;
$$;

create or replace function public.confirm_room_rewatch(p_confirmation_id uuid, p_confirmed boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row public.room_rewatch_confirmations%rowtype;
begin
  select * into v_row from public.room_rewatch_confirmations where id = p_confirmation_id and user_id = auth.uid();
  if not found then
    raise exception 'confirmation not found';
  end if;
  if v_row.status != 'pending' then
    return;
  end if;

  if p_confirmed then
    update public.watched_episodes
    set times_watched = times_watched + 1, watched_at = now()
    where user_id = v_row.user_id and tvmaze_episode_id = v_row.tvmaze_episode_id;
    update public.room_rewatch_confirmations set status = 'confirmed', resolved_at = now() where id = p_confirmation_id;
  else
    update public.room_rewatch_confirmations set status = 'declined', resolved_at = now() where id = p_confirmation_id;
  end if;

  delete from public.notifications where rewatch_confirmation_id = p_confirmation_id;
end;
$$;

grant execute on function public.confirm_room_rewatch(uuid, boolean) to authenticated;

-- Per-episode undo (narrower than unmark_episodes_watched_for_room above,
-- which undoes every episode of a show at once) — app/rooms/[id].tsx's
-- per-episode expanded list undoes one row at a time.
create or replace function public.unmark_episode_watched_for_room(
  p_room_id uuid, p_tvmaze_episode_id int
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.room_members me
    where me.room_id = p_room_id and me.user_id = auth.uid() and me.status = 'accepted'
  ) then
    raise exception 'not a member of this room';
  end if;

  delete from public.watched_episodes
  where tvmaze_episode_id = p_tvmaze_episode_id
    and user_id in (select rm.user_id from public.room_members rm where rm.room_id = p_room_id and rm.status = 'accepted');

  delete from public.room_watch_log
  where room_id = p_room_id and content_type = 'episode' and tvmaze_episode_id = p_tvmaze_episode_id;
end;
$$;

grant execute on function public.unmark_episode_watched_for_room(uuid, int) to authenticated;

-- ============================================================
-- Report replies — turns public.reports from a one-shot "file a report, get
-- at most one overwritten admin_reply back" dead end into a real threaded
-- conversation, the same upgrade support_message_replies already gave
-- support_messages above. reports.reason stays the reporter's original
-- message; admin_reply/admin_reply_at stop being written to (left in place,
-- never backfilled, purely so an old report answered before this migration
-- still shows its answer) — every reply after that, from either side, is a
-- row here. resolution_note/resolved_by/resolved_at stay exactly as they
-- were: the admin-only "why resolved/dismissed" audit trail, independent of
-- this conversation. Purely additive — safe to run once.
-- ============================================================
create table if not exists public.report_replies (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  is_admin boolean not null default false,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

alter table public.report_replies enable row level security;

create policy "Reporters view replies on their own reports"
  on public.report_replies
  for select
  using (
    exists (select 1 from public.reports r where r.id = report_id and r.reporter_id = auth.uid())
  );

create policy "Reporters reply to their own reports"
  on public.report_replies
  for insert
  with check (
    auth.uid() = author_id
    and is_admin = false
    and exists (select 1 from public.reports r where r.id = report_id and r.reporter_id = auth.uid())
  );

create policy "Admins view all report replies"
  on public.report_replies
  for select
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin));

create policy "Admins reply to any report"
  on public.report_replies
  for insert
  with check (
    auth.uid() = author_id
    and is_admin = true
    and exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin)
  );

create index if not exists report_replies_report_idx on public.report_replies (report_id, created_at);

-- Lets lib/reports.ts's sendReporterReply flip a resolved/dismissed report
-- back to 'open' when the reporter follows up on it — same reopen-on-reply
-- behavior support_messages already has, and for the same reason: without
-- this, only the "Admins update reports" policy could touch this table, so
-- that reopen silently updated zero rows for every non-admin reporter.
create policy "Reporters reopen their own reports"
  on public.reports
  for update
  using (auth.uid() = reporter_id)
  with check (auth.uid() = reporter_id);

-- Supersedes the original send_report_reply above: now appends to the
-- thread (report_replies) instead of overwriting the single admin_reply
-- column, and returns the created row so the admin screen can append it to
-- its own thread state immediately instead of refetching. Still security
-- definer for the same reason as before — a client has no insert policy
-- letting it write into someone else's notifications row directly.
create or replace function public.send_report_reply(p_report_id uuid, p_message text)
returns public.report_replies language plpgsql security definer set search_path = public as $$
declare
  v_reporter_id uuid;
  v_reply public.report_replies;
begin
  if not exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;

  select reporter_id into v_reporter_id from public.reports where id = p_report_id;
  if v_reporter_id is null then
    raise exception 'report not found';
  end if;

  insert into public.report_replies (report_id, author_id, is_admin, body)
  values (p_report_id, auth.uid(), true, p_message)
  returning * into v_reply;

  insert into public.notifications (user_id, type, actor_id, report_id, report_message)
  values (v_reporter_id, 'report_response', auth.uid(), p_report_id, p_message);

  return v_reply;
end;
$$;

grant execute on function public.send_report_reply(uuid, text) to authenticated;

-- Realtime for the report ticket thread (see lib/reports.ts's
-- subscribeToReportReplies, used by app/reports/[id].tsx) — same reasoning
-- as support_message_replies' own realtime block above: a self-hosted
-- instance needs the table added to the `supabase_realtime` publication
-- directly, or postgres_changes subscriptions connect but never deliver.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'report_replies'
  ) then
    alter publication supabase_realtime add table public.report_replies;
  end if;
end $$;
