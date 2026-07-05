import { Language } from "./userSettings";

const DAY_NAMES: Record<Language, string[]> = {
  en: ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"],
  fr: ["DIMANCHE", "LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI", "SAMEDI"],
};

const TODAY_WORD: Record<Language, string> = { en: "TODAY", fr: "AUJOURD'HUI" };
const YESTERDAY_WORD: Record<Language, string> = { en: "YESTERDAY", fr: "HIER" };
const TOMORROW_WORD: Record<Language, string> = { en: "TOMORROW", fr: "DEMAIN" };
const LATER_WORD: Record<Language, string> = { en: "LATER", fr: "PLUS TARD" };
const EARLIER_WORD: Record<Language, string> = { en: "EARLIER", fr: "AVANT" };

export function todayISODate() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function diffDaysFromToday(isoDate: string) {
  const target = new Date(isoDate + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function todayFullLabel(language: Language = "en") {
  const now = new Date();
  const formatted = now
    .toLocaleDateString(language, { month: "short", day: "numeric", year: "numeric" })
    .toUpperCase();
  return `${TODAY_WORD[language]} · ${formatted}`;
}

export function dateLabel(isoDate: string, language: Language = "en") {
  const target = new Date(isoDate + "T00:00:00");
  const diffDays = diffDaysFromToday(isoDate);

  if (diffDays === 0) return todayFullLabel(language);
  if (diffDays === -1) return YESTERDAY_WORD[language];
  if (diffDays === 1) return TOMORROW_WORD[language];
  if (diffDays > 1 && diffDays < 7) return DAY_NAMES[language][target.getDay()];

  const sameYear = target.getFullYear() === new Date().getFullYear();
  return target
    .toLocaleDateString(language, {
      month: "short",
      day: "numeric",
      year: sameYear ? undefined : "numeric",
    })
    .toUpperCase();
}

export function formatTime(airstamp: string) {
  return new Date(airstamp).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * Groups more than a week away (in either direction) collapse into a single
 * bucket so the list doesn't fragment into dozens of one-off date headers.
 */
export function upcomingGroupKey(isoDate: string) {
  const diffDays = diffDaysFromToday(isoDate);
  if (diffDays >= 7) return "LATER";
  if (diffDays <= -7) return "EARLIER";
  return isoDate;
}

export function upcomingGroupLabel(key: string, isoDate: string, language: Language = "en") {
  if (key === "LATER") return LATER_WORD[language];
  if (key === "EARLIER") return EARLIER_WORD[language];
  return dateLabel(isoDate, language);
}
