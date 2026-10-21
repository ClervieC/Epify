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
    version: "5.3.0",
    date: "2026-10-21",
    en: [
      "You can now change your username from Settings.",
      "Added a way to report a problem that isn't about a specific show, movie, comment, or user — from Settings.",
      "Admins can now reply directly to a report, so the person who filed it hears back when it's fixed or can't be fixed.",
      "Fixed photos not attaching when filing a report, or when changing your avatar, on iPhone (including from the Home Screen bookmark) and some desktop browsers — the file picker was opening in a way Safari silently ignored.",
      "You can now drag and drop images into a report instead of only using the file picker.",
      "A room invite can now be accepted or declined right from the Rooms list, not only from Notifications.",
      "Sharing an episode or movie with a room now shows a confirmation, instead of looking like nothing happened — which could previously lead to sharing the same thing more than once.",
      "Fixed a search box showing your saved passwords as autofill suggestions on Mac.",
    ],
    fr: [
      "Tu peux maintenant changer de pseudo depuis les Réglages.",
      "Ajout d'un moyen de signaler un problème qui ne concerne ni une série, ni un film, ni un commentaire, ni un utilisateur précis — depuis les Réglages.",
      "Les modérateurs peuvent maintenant répondre directement à un signalement, pour que la personne sache qu'il a été corrigé ou qu'il ne peut pas l'être.",
      "Correction d'un bug empêchant d'ajouter une photo à un signalement, ou de changer sa photo de profil, sur iPhone (y compris depuis le raccourci à l'écran d'accueil) et certains navigateurs d'ordinateur — le sélecteur de fichier s'ouvrait d'une façon que Safari ignorait silencieusement.",
      "Tu peux maintenant glisser-déposer des images dans un signalement, en plus du sélecteur de fichier.",
      "Une invitation à une room peut maintenant être acceptée ou refusée directement depuis la liste des rooms, pas seulement depuis les notifications.",
      "Partager un épisode ou un film avec une room affiche maintenant une confirmation, au lieu de ne rien montrer — ce qui pouvait auparavant mener à partager la même chose plusieurs fois.",
      "Correction d'une barre de recherche qui proposait tes mots de passe enregistrés en autofill sur Mac.",
    ],
  },
  {
    version: "5.2.4",
    date: "2026-10-20",
    en: [
      "Fixed title/content sitting behind the status bar on nearly every screen on an iPhone opened from its Home Screen bookmark — most noticeable on Profile, where the username and email overlapped the time/battery icons.",
    ],
    fr: [
      "Correction du titre/contenu qui s'affichait derrière la barre de statut sur presque tous les écrans, sur un iPhone ouvert depuis son raccourci à l'écran d'accueil — le plus visible sur le Profil, où le pseudo et l'e-mail chevauchaient l'heure/la batterie.",
    ],
  },
  {
    version: "5.2.3",
    date: "2026-10-20",
    en: [
      "Fixed the bottom tab bar having too much empty space below its labels on an iPhone opened from its Home Screen bookmark — it was padded for both its own spacing and the home-indicator clearance stacked together, instead of just the larger of the two.",
    ],
    fr: [
      "Correction d'un espace vide trop important sous les onglets du bas sur un iPhone ouvert depuis son raccourci à l'écran d'accueil — l'espacement propre à la barre et la marge de la home indicator s'additionnaient au lieu de ne garder que la plus grande des deux.",
    ],
  },
  {
    version: "5.2.2",
    date: "2026-10-20",
    en: [
      "History on the Shows tab no longer loads itself the moment the screen finishes loading — it now only appears once you actually pull up past the top of the list for it, like it was meant to.",
    ],
    fr: [
      "L'historique de l'onglet Séries ne se charge plus tout seul dès que l'écran a fini de charger — il n'apparaît désormais que si tu tires vraiment vers le haut, au-delà du sommet de la liste.",
    ],
  },
  {
    version: "5.2.1",
    date: "2026-10-20",
    en: [
      "Fixed a blank strip of empty space at the bottom of the screen on an iPhone opened from its Home Screen bookmark (standalone mode) — the page could render taller than the actual visible screen there, pushing the bottom tab bar up off the true edge.",
    ],
    fr: [
      "Correction d'une bande vide en bas de l'écran sur un iPhone ouvert depuis son raccourci à l'écran d'accueil (mode autonome) — la page pouvait s'afficher plus haute que l'écran réellement visible, décalant la barre d'onglets du bas par rapport au vrai bord de l'écran.",
    ],
  },
  {
    version: "5.2.0",
    date: "2026-10-20",
    en: [
      "New: Rooms — create a small group to watch shows and movies together, found via the \"Rooms\" button on the Social tab. Invite people, and the next time you mark an episode or movie watched, you can share it with the room so it shows up for everyone in it.",
      "Rooms can get an optional icon, and you can link one to a show to see everyone's watching progress side by side.",
      "You're notified when someone shares something with a room you're in — a whole season shared at once is a single notification, not one per episode.",
      "A room's creator can edit it (name, icon, end date, linked show) or remove a member. Any member can also log something the room already watched together directly from the room screen, without needing to find it on its own page first.",
    ],
    fr: [
      "Nouveau : les Rooms — crée un petit groupe pour regarder des séries et films ensemble, accessible via le bouton \"Rooms\" de l'onglet Social. Invite des personnes, et la prochaine fois que tu marques un épisode ou un film comme vu, tu peux le partager avec la room pour qu'il apparaisse chez tout le monde.",
      "Une room peut avoir une icône optionnelle, et tu peux la lier à une série pour voir la progression de chacun côte à côte.",
      "Tu es notifié(e) quand quelqu'un partage quelque chose avec une room dont tu fais partie — une saison entière partagée d'un coup donne une seule notification, pas une par épisode.",
      "Le créateur d'une room peut la modifier (nom, icône, date de fin, série liée) ou retirer un membre. N'importe quel membre peut aussi ajouter directement depuis la room quelque chose déjà regardé ensemble, sans avoir à le retrouver sur sa propre page.",
    ],
  },
  {
    version: "5.1.14",
    date: "2026-10-19",
    en: [
      "Added \"See who's watched what\" — small icons on an episode's page and on a show's episode list for the people you follow who've already watched it, with hover tooltips showing their name on desktop. Off by default; you're asked once (new accounts during sign-up, existing accounts the next time you open the app) and can change it anytime in Settings.",
      "Fixed scrolling position resetting to the top when rotating your device (portrait/landscape) while browsing someone's full shows/movies list.",
    ],
    fr: [
      "Ajout de \"Voir qui a vu quoi\" — de petites icônes sur la page d'un épisode et sur la liste des épisodes d'une série pour les personnes que tu suis qui les ont déjà vus, avec une infobulle affichant leur nom au survol sur ordinateur. Désactivé par défaut ; on te le demande une fois (à l'inscription pour un nouveau compte, à la prochaine ouverture de l'appli pour un compte existant), modifiable à tout moment dans les réglages.",
      "Correction du défilement qui revenait en haut de la liste lors d'une rotation de l'appareil (portrait/paysage) en parcourant la liste complète des séries/films de quelqu'un.",
    ],
  },
  {
    version: "5.1.13",
    date: "2026-10-13",
    en: [
      "On someone else's profile, shows and movies you already have in your list now show a checkmark on the poster (tap it to add/remove, just like on your own \"View all\" pages).",
      "Movies on your own profile now display the same way as shows — removed the separate watched-checkmark overlay.",
      "Fixed the \"How did it make you feel?\" popup's last row of emotions sitting right against (or under) the home indicator on phone — it's pushed up out of the way now.",
    ],
    fr: [
      "Sur le profil de quelqu'un d'autre, les séries et films déjà dans ta liste affichent maintenant une coche sur le poster (appuie dessus pour ajouter/retirer, comme sur tes pages \"Voir tout\").",
      "Les films sur ton propre profil s'affichent maintenant comme les séries — suppression de l'overlay \"vu\" séparé.",
      "Correction de la dernière ligne d'émotions du popup \"Comment tu t'es senti(e) ?\" collée contre (voire sous) la barre d'accueil sur téléphone — elle est maintenant remontée.",
    ],
  },
  {
    version: "5.1.12",
    date: "2026-10-12",
    en: [
      "Recap (Monthly/Year) now loads instantly after the first time you check a given month/year — it's saved instead of being recomputed every single visit, on this device and any other you're signed into.",
    ],
    fr: [
      "Le bilan (mensuel/annuel) se charge maintenant instantanément après la première fois que tu consultes un mois/une année donné — il est sauvegardé au lieu d'être recalculé à chaque visite, sur cet appareil et tout autre où tu es connecté.",
    ],
  },
  {
    version: "5.1.11",
    date: "2026-10-12",
    en: [
      "Fixed unmarking an episode on a finished show not bringing it back to Watch Next/your list — it stayed stuck as \"Watched\" (same for a Paused/Dropped show) no matter what you unwatched.",
    ],
    fr: [
      "Correction d'un bug où décocher un épisode d'une série terminée ne la ramenait pas dans Watch Next/ta liste — elle restait bloquée sur \"Vue\" (pareil pour une série en pause/abandonnée), peu importe ce que tu décochais.",
    ],
  },
  {
    version: "5.1.10",
    date: "2026-10-01",
    en: [
      "Added a Monthly Recap — hours watched, episodes, movies, and your most-watched show/movie for any month you've finished, found on the Social tab. A small banner lets you know as soon as a new one's ready.",
      "Your Year recap now also shows any past year, anytime — previously it only worked during the late-December/mid-January window. That window is still when the current year's own Wrapped opens up.",
      "Sharing a recap now shares an actual photo card (with a blurred poster background) instead of plain text, so it looks right when posted to Instagram/etc.",
      "Fixed the year recap banner on your profile showing the wrong year during the first two weeks of January.",
    ],
    fr: [
      "Ajout d'un bilan mensuel — temps regardé, épisodes, films, et ta série/film le plus regardé pour n'importe quel mois déjà terminé, sur l'onglet Social. Une petite bannière te prévient dès qu'un nouveau est prêt.",
      "Ton bilan annuel montre maintenant aussi n'importe quelle année passée, à tout moment — avant ça ne marchait que pendant la fenêtre fin décembre/mi-janvier. Cette fenêtre reste nécessaire pour le bilan de l'année en cours.",
      "Partager un bilan partage maintenant une vraie photo (avec un fond flouté à partir d'un poster) au lieu de texte brut, pour que ça rende bien une fois posté sur Instagram/etc.",
      "Correction de la bannière de bilan annuel sur le profil qui affichait la mauvaise année pendant les deux premières semaines de janvier.",
    ],
  },
  {
    version: "5.1.9",
    date: "2026-09-29",
    en: [
      "Added favorite and \"add to my list\" buttons directly on the cards in Explore's and Profile's \"View all\" pages, so you don't have to open a show/movie first to act on it.",
      "\"View all\" cards (Explore search, Explore's \"View all\", and Profile's \"View all\") are now all the same, smaller size — 3 per row on a phone instead of 1–2.",
      "Fixed a Profile \"View all\" page not being centered when it only had a single card (or an uneven last row).",
      "Added a bit of margin to the \"Shows\"/\"Movies\" section titles in search results — they were sitting flush against the screen edge.",
      "The Social feed no longer hides a same-day binge of more than 25 episodes entirely — it now shows as \"watched 25+ episodes of [show]\" instead of the full episode-by-episode list.",
    ],
    fr: [
      "Ajout des boutons favori et \"ajouter à ma liste\" directement sur les cards des pages \"Voir tout\" de l'Explore et du Profil, plus besoin d'ouvrir une série/un film pour agir dessus.",
      "Les cards des pages \"Voir tout\" (recherche Explore, \"Voir tout\" de l'Explore, \"Voir tout\" du Profil) ont maintenant toutes la même taille, plus petite — 3 par ligne sur téléphone au lieu de 1-2.",
      "Correction d'une page \"Voir tout\" du Profil pas centrée quand elle n'avait qu'une seule card (ou une dernière rangée incomplète).",
      "Ajout d'une marge aux titres \"Séries\"/\"Films\" dans les résultats de recherche — ils étaient collés au bord de l'écran.",
      "Le fil Social ne masque plus entièrement un visionnage de plus de 25 épisodes en une journée — il affiche maintenant \"a regardé 25+ épisodes de [série]\" au lieu de la liste détaillée des épisodes.",
    ],
  },
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
