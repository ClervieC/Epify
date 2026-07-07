-- Run this in the Supabase SQL editor for your project.

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
  rating smallint check (rating between 1 and 10),
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
