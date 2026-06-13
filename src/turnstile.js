import { appConfig } from "./config.js";

const widgets = new Map();
let loader = null;

export async function initTurnstile() {
  const slots = [...document.querySelectorAll("[data-turnstile-action]")];
  if (!appConfig.turnstileSiteKey) {
    slots.forEach((slot) => { slot.hidden = true; });
    return;
  }

  try {
    await loadTurnstile();
    slots.forEach((slot) => {
      slot.hidden = false;
      if (widgets.has(slot)) return;
      const widgetId = window.turnstile.render(slot, {
        sitekey: appConfig.turnstileSiteKey,
        action: slot.dataset.turnstileAction,
        theme: "dark",
        size: "flexible",
      });
      widgets.set(slot, widgetId);
    });
  } catch (error) {
    console.error("Turnstile initialization failed", error);
  }
}

export function turnstileToken(form) {
  return form.querySelector("[name='cf-turnstile-response']")?.value || "";
}

export function resetTurnstile(form) {
  const slot = form.querySelector("[data-turnstile-action]");
  const widgetId = widgets.get(slot);
  if (widgetId != null && window.turnstile) window.turnstile.reset(widgetId);
}

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error("Turnstile script failed")), { once: true });
    document.head.append(script);
  });
  return loader;
}
