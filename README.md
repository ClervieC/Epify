# Epify

App de suivi de séries (remplaçant TVTime) : à voir / en cours / vues / arrêtées, alimentée par l'API [TVmaze](https://www.tvmaze.com/api) et un compte Supabase pour la sauvegarde.

## Stack
- Expo (React Native + Web) avec expo-router
- Supabase (auth + base de données Postgres)
- TVmaze API (recherche, planning, détails des séries)

## Mise en route

1. Crée les tables Supabase : ouvre le SQL editor de ton projet et exécute [supabase/schema.sql](supabase/schema.sql).
   > **Self-hosted uniquement** : contrairement à Supabase Cloud (où le SQL editor tourne en superuser `postgres` et accorde tout implicitement), une instance self-hosted (VPS, Docker) doit recevoir explicitement le droit de créer des clés étrangères vers `auth.users` — beaucoup de tables du schéma en dépendent (`comments`, `user_shows`, `notifications`, etc.). Avant d'exécuter `schema.sql` (ou toute migration qui ajoute une table référençant `auth.users`), lance une fois, connectée en tant que `supabase_admin` :
   > ```
   > sudo docker exec -it <nom_du_container_postgres> psql -U supabase_admin -d postgres -c "
   > GRANT REFERENCES ON auth.users TO postgres;
   > GRANT REFERENCES ON auth.users TO anon, authenticated, service_role;
   > "
   > ```
   > Sans ça, toute table qui fait `references auth.users (id)` échoue avec `42501: permission denied for table users`.
   >
   > **Self-hosted aussi** : le chat support (`app/support.tsx`) reçoit les nouveaux messages en direct via Supabase Realtime, ce qui suppose que `support_message_replies` fasse partie de la publication `supabase_realtime` — `schema.sql` s'en charge (bloc en bas du fichier), mais uniquement si le service Realtime tourne déjà sur ton instance. Sur Cloud, c'est activable/vérifiable aussi depuis Database > Replication.
2. Les clés d'API sont dans `.env` (non versionné). Vérifie qu'elles sont correctes :
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - `EXPO_PUBLIC_TVMAZE_API_KEY`
3. Lance le projet :
   ```
   npm start        # menu Expo (web/android/ios)
   npm run web
   npm run android
   npm run ios
   ```

> Note environnement : si `expo start` échoue avec `unable to get local issuer certificate` (proxy d'entreprise), relance avec :
> `NODE_TLS_REJECT_UNAUTHORIZED=0 npx expo start` (dev local uniquement, à ne pas utiliser en CI/prod).

## Structure
- `app/(auth)` — écrans de connexion / inscription (Supabase Auth)
- `app/(tabs)` — Découvrir (planning du jour), Mes séries, Recherche, Profil
- `app/show/[id].tsx` — détail d'une série + changement de statut
- `lib/tvmaze.ts` — client de l'API TVmaze
- `lib/userShows.ts` — CRUD Supabase pour les séries suivies par l'utilisateur
- `lib/supabase.ts` — client Supabase
