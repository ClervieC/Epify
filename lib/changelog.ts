// Maintained by hand at each release — write for the person reading it, not
// a dump of commit messages. Newest entry first. Keep app.json/package.json
// "version" AND public/version.json in sync with CHANGELOG[0].version when
// you cut a new release — the last one is what lib/versionCheck.ts polls on
// web to force-reload a stale open tab/PWA onto the new build; forgetting
// it there just means that check silently never fires, not a hard error.
export interface ChangelogEntry {
  version: string;
  date: string; // YYYY-MM-DD
  en: string[];
  fr: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  // Newest entry first — CHANGELOG[0] drives the version shown in Settings
  // (see the file-level comment above for everything else to keep in sync).
  {
    version: "5.1.8",
    date: "2026-09-28",
    en: [
      "Fixed the report pop-up sometimes appearing below the page content on Movies and Episode screens, and sometimes off-center or barely dimmed on Movies — it now always shows centered on top with a darker backdrop, wherever you are on the page.",
      "Added tooltips on a show's page explaining what the star and \"...\" icons do.",
      "Watch Next now loads your Watch Later and Not Started shows first, before less important things like comments — noticeably faster.",
      "Badges no longer show a flood of \"unlocked\" alerts the first time you open the app — only when you actually just earned one.",
      "Shows are now cached and shared across users on the backend, so an already-tracked show loads faster for everyone.",
      "The sign-up confirmation message now mentions checking your spam folder.",
      "The \"watched\" checkmark on a movie's page is bigger and now properly aligned with the \"Watched on [date]\" label next to it.",
      "The Social feed no longer shows a giant list when someone adds more than 25 episodes at once.",
      "Reports in the admin panel now link directly to the reported show/episode/movie/comment.",
      "Added \"View all\" pages for Explore categories and for every list on a profile (yours and others') — a full scrollable grid instead of a single row, with a search-style genre filter.",
      "Fixed cards on these \"View all\" pages being way too big on a wide screen — they're now the same size as search results, with as many fitting per row as the screen allows, and centered.",
      "Fixed the Explore genre filter pills briefly turning into giant bars while switching genres.",
    ],
    fr: [
      "Correction de la pop-up de signalement qui apparaissait parfois sous le contenu de la page sur Films et Épisode, et parfois mal centrée ou à peine assombrie sur Films — elle s'affiche maintenant toujours centrée au-dessus avec un fond plus sombre, peu importe où tu es sur la page.",
      "Ajout de tooltips sur la page d'une série expliquant ce que font l'étoile et les trois petits points.",
      "Watch Next charge maintenant en priorité tes séries \"à regarder plus tard\" et \"pas commencées\" avant les éléments moins importants comme les commentaires — nettement plus rapide.",
      "Les badges n'affichent plus une avalanche d'alertes \"débloqué\" à la première ouverture de l'appli — seulement quand tu viens vraiment d'en gagner un.",
      "Les séries sont maintenant mises en cache et partagées entre utilisateurs côté serveur, donc une série déjà suivie se charge plus vite pour tout le monde.",
      "Le message de confirmation d'inscription mentionne maintenant de vérifier le dossier spam.",
      "La coche \"vu\" sur la page d'un film est plus grande et correctement alignée avec le texte \"Vu le [date]\" à côté.",
      "Le fil Social n'affiche plus une liste géante quand quelqu'un ajoute plus de 25 épisodes d'un coup.",
      "Les signalements dans le panneau admin renvoient maintenant directement vers la série/l'épisode/le film/le commentaire signalé.",
      "Ajout de pages \"Tout voir\" pour les catégories d'Explore et pour chaque liste d'un profil (le tien et ceux des autres) — une grille défilante complète au lieu d'une seule rangée, avec un filtre par genre façon recherche.",
      "Correction des cartes sur ces pages \"Tout voir\" qui étaient beaucoup trop grandes sur un écran large — elles ont maintenant la même taille que dans la recherche, avec autant de cartes par ligne que l'écran le permet, et centrées.",
      "Correction des pastilles de filtre par genre d'Explore qui se transformaient brièvement en barres géantes pendant le changement de genre.",
    ],
  },
  {
    version: "5.1.7",
    date: "2026-09-22",
    en: [
      "The web app now loads much faster when reopened from your iPhone's Home Screen after being fully closed — it no longer has to re-download everything from scratch every time.",
    ],
    fr: [
      "L'appli web se charge maintenant beaucoup plus vite quand tu la rouvres depuis l'écran d'accueil de ton iPhone après l'avoir complètement fermée — elle n'a plus besoin de tout retélécharger à chaque fois.",
    ],
  },
  {
    version: "5.1.6",
    date: "2026-09-22",
    en: [
      "Comments on a show/episode open faster on a repeat visit within the same session.",
      "Badge/streak progress updates faster after marking something watched — it no longer re-scans your whole watch history on every single action.",
    ],
    fr: [
      "Les commentaires d'une série/épisode s'ouvrent plus vite en cas de revisite dans la même session.",
      "La progression des badges/streaks se met à jour plus vite après avoir marqué quelque chose comme vu — elle ne rescanne plus tout ton historique à chaque action.",
    ],
  },
  {
    version: "5.1.5",
    date: "2026-09-22",
    en: [
      "Marking an episode watched no longer pops the History section into view — it updates there next time you revisit the tab instead.",
    ],
    fr: [
      "Marquer un épisode comme vu ne fait plus apparaître la section Historique à l'écran — elle se met à jour normalement la prochaine fois que tu reviens sur l'onglet.",
    ],
  },
  {
    version: "5.1.4",
    date: "2026-09-15",
    en: [
      "The Social feed no longer briefly shows \"?\" avatars and \"#12345\" show names before they load — each item now appears fully loaded, in small most-recent-first batches.",
      "Fixed Upcoming cards with several badges (e.g. PREMIERE + episode count) sometimes growing taller than the others and overlapping the card below.",
      "Opening a show or episode is faster — it no longer occasionally waits up to 10s behind background loading.",
      "Fixed Watch Next sometimes taking a while to drop an episode after marking a whole show as watched from its own page.",
    ],
    fr: [
      "Le fil Social n'affiche plus brièvement des avatars \"?\" et des noms de séries \"#12345\" avant leur chargement — chaque élément apparaît désormais entièrement chargé, par petits lots du plus récent au plus ancien.",
      "Correction des cartes de la liste Upcoming avec plusieurs badges (ex. PREMIÈRE + nombre d'épisodes) qui devenaient parfois plus grandes que les autres et chevauchaient la carte du dessous.",
      "Ouvrir une série ou un épisode est plus rapide — ça n'attend plus parfois jusqu'à 10s derrière le chargement en arrière-plan.",
      "Correction de Watch Next qui pouvait mettre du temps à retirer un épisode après avoir marqué toute une série comme vue depuis sa page.",
    ],
  },
  {
    version: "5.1.3",
    date: "2026-08-27",
    en: [
      "The Social feed now loads noticeably faster — recent activity shows up almost instantly, with details filling in right after.",
      "Watch Next now shows a loading indicator instead of a misleading empty message while your shows are still being fetched.",
    ],
    fr: [
      "Le fil Social se charge nettement plus vite — l'activité récente s'affiche presque instantanément, les détails se complètent juste après.",
      "Watch Next affiche désormais un indicateur de chargement au lieu d'un message vide trompeur pendant que tes séries sont encore en cours de récupération.",
    ],
  },
  {
    version: "5.1.2",
    date: "2026-08-21",
    en: [
      "Fixed the \"almost unlocked\" badge toast sometimes popping up several times in a row.",
      "The app now updates itself in the background when a new version ships — no more need to manually refresh to get the latest fixes.",
    ],
    fr: [
      "Correction du message \"presque débloqué\" qui pouvait parfois apparaître plusieurs fois d'affilée.",
      "L'appli se met désormais à jour toute seule en arrière-plan à chaque nouvelle version — plus besoin de rafraîchir manuellement pour profiter des derniers correctifs.",
    ],
  },
  {
    version: "5.1.1",
    date: "2026-08-21",
    en: [
      "New: \"binge\" badges — earned for days you really marathon a show (marking a whole season watched at once doesn't count).",
      "New: a heads-up toast when you're one action away from unlocking a badge.",
      "Fixed a bug where already-watched episodes on shows with a long viewing history could show up as unwatched again.",
      "\"For You\" recommendations in Discover now show up reliably.",
      "Several small fixes and polish across empty states, badges, and loading screens.",
    ],
    fr: [
      "Nouveau : des badges \"marathon\" — obtenus pour les journées où tu enchaînes vraiment les épisodes (marquer une saison entière vue d'un coup ne compte pas).",
      "Nouveau : un message quand tu es à un pas de débloquer un badge.",
      "Correction d'un bug où des épisodes déjà vus sur des séries à l'historique long pouvaient réapparaître comme non vus.",
      "Les recommandations \"Pour toi\" dans Découvrir s'affichent maintenant de façon fiable.",
      "Plusieurs petites corrections et améliorations sur les listes vides, les badges et les écrans de chargement.",
    ],
  },
  {
    version: "5.1.0",
    date: "2026-08-21",
    en: [
      'New: a "What\'s new" screen — see what changed at a glance, with a quick heads-up on the Shows tab after an update.',
      "New: genre badges — unlock badges for the shows and movies you watch by genre (Comedy, Romance, Drama, and more).",
      "Badges are now front and center on your profile, and unlock instantly the moment you earn them.",
    ],
    fr: [
      'Nouveau : un écran "Nouveautés" pour voir ce qui a changé, avec un message rapide sur l\'onglet Séries après une mise à jour.',
      "Nouveau : des badges par genre — débloque des badges selon les genres de séries et films que tu regardes (Comédie, Romance, Drame, et plus).",
      "Les badges sont maintenant mis en avant sur ton profil, et se débloquent instantanément dès que tu les obtiens.",
    ],
  },
  {
    version: "5.0.9",
    date: "2026-08-19",
    en: ["The \"Not started\" list now shows your most recently added shows first."],
    fr: ["La liste \"Pas commencées\" affiche maintenant tes ajouts les plus récents en premier."],
  },
  {
    version: "5.0.8",
    date: "2026-08-19",
    en: [
      "Fixed a bug where long-running shows (1000+ watched episodes) could lose track of what you'd already watched after restarting the app.",
    ],
    fr: [
      "Correction d'un bug où les séries très longues (plus de 1000 épisodes vus) pouvaient perdre la trace de ce que tu avais déjà vu après un redémarrage de l'appli.",
    ],
  },
  {
    version: "5.0.7",
    date: "2026-08-19",
    en: [
      "Discover now has separate TV and Movies tabs, so search results don't mix the two.",
      "Empty lists now offer a direct link to Discover shows or movies.",
      "Profile screen reorganized to be easier to scan.",
    ],
    fr: [
      "Découvrir a maintenant des onglets séparés Séries et Films, pour ne plus mélanger les résultats.",
      "Les listes vides proposent maintenant un lien direct pour découvrir des séries ou des films.",
      "Écran Profil réorganisé pour être plus lisible d'un coup d'œil.",
    ],
  },
  {
    version: "5.0.6",
    date: "2026-08-19",
    en: ["Show pages load noticeably faster thanks to a rebuilt caching layer."],
    fr: ["Les fiches séries se chargent nettement plus vite grâce à un système de cache repensé."],
  },
  {
    version: "5.0.5",
    date: "2026-08-08",
    en: ["New reaction: \"Loved\" ❤️, added to the quick-feeling picker."],
    fr: ["Nouvelle réaction : \"Adoré\" ❤️, ajoutée au sélecteur de ressenti rapide."],
  },
  {
    version: "5.0.4",
    date: "2026-08-06",
    en: [
      "Faster, lighter background sync so the app stays snappy between visits.",
    ],
    fr: [
      "Synchronisation en arrière-plan plus rapide et plus légère pour une appli plus fluide.",
    ],
  },
  {
    version: "5.0.3",
    date: "2026-08-06",
    en: [
      "The home screen now loads faster thanks to smarter background prefetching.",
    ],
    fr: [
      "L'écran d'accueil se charge plus vite grâce à un préchargement plus intelligent.",
    ],
  },
  {
    version: "5.0.2",
    date: "2026-08-06",
    en: ["Fixed a few caching issues affecting show data and TV Time imports."],
    fr: [
      "Correction de bugs de cache affectant les données des séries et les imports TV Time.",
    ],
  },
  {
    version: "5.0.1",
    date: "2026-08-04",
    en: [
      "Behind-the-scenes cleanup of how show data is refreshed — more reliable, less bandwidth.",
    ],
    fr: [
      "Nettoyage en coulisses du rafraîchissement des données — plus fiable, moins gourmand.",
    ],
  },
  {
    version: "5.0.0",
    date: "2026-08-04",
    en: [
      "New: an upcoming releases calendar, with month and week views.",
      "Improved support conversations and notifications.",
    ],
    fr: [
      "Nouveau : un calendrier des sorties à venir, avec vues mois et semaine.",
      "Amélioration des conversations avec le support et des notifications.",
    ],
  },
  {
    version: "4.8.5",
    date: "2026-08-04",
    en: [
      "A gentle prompt now invites you to add a show to your list before rating it.",
    ],
    fr: [
      "Une invitation apparaît désormais pour ajouter une série à ta liste avant de la noter.",
    ],
  },
  {
    version: "4.8.4",
    date: "2026-08-03",
    en: [
      "Profile, admin, and movie screens polished with several small fixes.",
    ],
    fr: [
      "Écrans profil, admin et films peaufinés avec plusieurs petites corrections.",
    ],
  },
  {
    version: "4.8.3",
    date: "2026-08-02",
    en: [
      "New: a celebratory toast when you finish a show.",
      "Comments got a visual refresh.",
    ],
    fr: [
      "Nouveau : un message de félicitations quand tu termines une série.",
      "Les commentaires ont eu un coup de neuf visuel.",
    ],
  },
  {
    version: "4.8.1",
    date: "2026-07-30",
    en: [
      "You can now pick your language directly from the sign-in and sign-up screens.",
    ],
    fr: [
      "Tu peux désormais choisir ta langue directement depuis les écrans de connexion et d'inscription.",
    ],
  },
];

export const APP_VERSION = CHANGELOG[0].version;
