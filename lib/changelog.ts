// Maintained by hand at each release — write for the person reading it, not
// a dump of commit messages. Newest entry first. Keep app.json/package.json
// "version" in sync with CHANGELOG[0].version when you cut a new release.
export interface ChangelogEntry {
  version: string;
  date: string; // YYYY-MM-DD
  en: string[];
  fr: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  // Newest entry first — CHANGELOG[0] drives the version shown in Settings,
  // so keep app.json/package.json "version" in sync with it by hand.
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
