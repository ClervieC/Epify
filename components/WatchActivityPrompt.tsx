import { useEffect, useState } from "react";
import { useLanguage } from "../lib/i18n";
import { fetchUserSettings } from "../lib/userSettings";
import { ChoiceDialog } from "./ChoiceDialog";

// One-time ask for anyone who already had an account before the "who among
// your following watched this" avatars shipped — a brand new account gets
// the exact same question as its own onboarding step instead (see app/
// onboarding.tsx's watchActivity step), so this never fires for them: by
// the time onboarding finishes, show_watch_activity is already non-null.
// Mounted once at the app root (see app/_layout.tsx, same spot/reasoning as
// NewMonthRecapToast) rather than on a specific tab, gated on
// session && !needsOnboarding there.
export function WatchActivityPrompt() {
  const { t, setShowWatchActivity } = useLanguage();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let active = true;
    // Bypasses the shared SettingsContext deliberately — that context
    // collapses null ("never asked") to false, which is exactly the
    // distinction this needs to tell "already answered no" apart from
    // "never asked at all."
    fetchUserSettings()
      .then((settings) => {
        if (active && settings.show_watch_activity === null) setVisible(true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  function choose(value: "yes" | "no") {
    setVisible(false);
    setShowWatchActivity(value === "yes");
  }

  return (
    <ChoiceDialog
      visible={visible}
      title={t.onboarding.watchActivityTitle}
      subtitle={t.onboarding.watchActivityBody}
      options={[
        { value: "no", label: t.onboarding.watchActivityNo },
        { value: "yes", label: t.onboarding.watchActivityYes, primary: true },
      ]}
      onChoose={choose}
      // Dismissing without picking leaves show_watch_activity unanswered
      // (still null) — it'll just ask again next app open, rather than
      // silently locking in a default the user never actually chose.
      onDismiss={() => setVisible(false)}
    />
  );
}
