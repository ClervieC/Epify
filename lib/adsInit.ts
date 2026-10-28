import { useSyncExternalStore } from "react";
import mobileAds, { AdsConsent, AdsConsentPrivacyOptionsRequirementStatus } from "react-native-google-mobile-ads";

// GDPR: in the EEA/UK, Google requires the UMP consent message to be shown
// (and answered) before any ad request. gatherConsent() asks the UMP SDK
// whether a message is needed for this user and presents it if so; outside
// regions that need one it resolves immediately without showing anything.
// The message itself is configured in the AdMob console (Privacy &
// messaging) — without one published there, nothing is shown and
// canRequestAds is decided by Google's defaults.
let canRequestAds = false;
// Whether Google says this user must be offered a way to change their
// answer later (true in regions where the consent message is shown) —
// drives the "Ad privacy choices" row in Settings.
let privacyOptionsRequired = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function initAds() {
  AdsConsent.gatherConsent()
    .then((info) => {
      privacyOptionsRequired =
        info.privacyOptionsRequirementStatus === AdsConsentPrivacyOptionsRequirementStatus.REQUIRED;
      notify();
      return info.canRequestAds;
    })
    // Network error etc. — fall back to whatever consent was given in an
    // earlier session rather than never showing ads again.
    .catch(() => AdsConsent.getConsentInfo().then((info) => info.canRequestAds))
    .catch(() => false)
    .then((allowed) => {
      if (!allowed) return;
      return mobileAds()
        .initialize()
        .then(() => {
          canRequestAds = true;
          notify();
        });
    });
}

// Re-opens Google's consent form so the user can change their answer.
export function showAdPrivacyOptions() {
  AdsConsent.showPrivacyOptionsForm().catch(() => {});
}

export function useAdPrivacyOptionsRequired(): boolean {
  return useSyncExternalStore(subscribe, () => privacyOptionsRequired);
}

// AdBanner renders nothing until this is true, so no ad request ever goes
// out before consent.
export function useCanRequestAds(): boolean {
  return useSyncExternalStore(subscribe, () => canRequestAds);
}
