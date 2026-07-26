"use client";

import { useEffect, useState } from "react";

const CONSENT_KEY = "meshmedic-analytics-consent";

type ConsentChoice = "granted" | "denied" | null;

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

function loadGoogleAnalytics(measurementId: string) {
  if (document.getElementById("meshmedic-google-analytics")) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // Google Analytics requires the function's Arguments object here.
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer.push(arguments);
  };
  window.gtag("consent", "default", {
    analytics_storage: "granted",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  window.gtag("js", new Date());
  window.gtag("config", measurementId, { send_page_view: true });
  window.gtag("event", "meshmedic_analytics_enabled");

  const script = document.createElement("script");
  script.id = "meshmedic-google-analytics";
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.appendChild(script);
}

export function AnalyticsConsent({ measurementId }: { measurementId: string }) {
  const [choice, setChoice] = useState<ConsentChoice>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const savedChoice = window.localStorage.getItem(CONSENT_KEY) as ConsentChoice;
    if (savedChoice === "granted" && measurementId) loadGoogleAnalytics(measurementId);
    if (savedChoice === "granted" || savedChoice === "denied") {
      const frame = window.requestAnimationFrame(() => setChoice(savedChoice));
      return () => window.cancelAnimationFrame(frame);
    }
  }, [measurementId]);

  const choose = (nextChoice: Exclude<ConsentChoice, null>) => {
    window.localStorage.setItem(CONSENT_KEY, nextChoice);
    setChoice(nextChoice);
    setSettingsOpen(false);

    if (nextChoice === "granted") {
      loadGoogleAnalytics(measurementId);
    } else if (window.gtag) {
      window.gtag("consent", "update", { analytics_storage: "denied" });
    }
  };

  const showBanner = choice === null || settingsOpen;

  if (!measurementId) return null;

  return (
    <>
      {showBanner && (
        <aside className="analytics-consent" role="dialog" aria-label="Analytics preferences" aria-live="polite">
          <div>
            <strong>Help us improve MeshMedic</strong>
            <p>Allow anonymous Google Analytics so we can understand which features are useful. Your STL is never uploaded or included in analytics.</p>
          </div>
          <div className="analytics-actions">
            <button className="analytics-decline" onClick={() => choose("denied")}>No thanks</button>
            <button className="analytics-accept" onClick={() => choose("granted")}>Allow analytics</button>
          </div>
        </aside>
      )}
      {choice !== null && !settingsOpen && (
        <button className="analytics-settings" onClick={() => setSettingsOpen(true)}>Analytics settings</button>
      )}
    </>
  );
}
