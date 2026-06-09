const legacyApiBaseUrl = readConfig("apiBaseUrl", "https://api.cremenality.ru").replace(/\/$/, "");

export const appConfig = {
  apiBaseUrl: legacyApiBaseUrl,
  authApiBaseUrl: readConfig("authApiBaseUrl", legacyApiBaseUrl).replace(/\/$/, ""),
  coreApiBaseUrl: readConfig("coreApiBaseUrl", "https://llm.cremenality.ru").replace(/\/$/, ""),
  chatAppUrl: readConfig("chatAppUrl", "https://cremenality.online/?v=20260610-handoff"),
  androidDownloadUrl: readConfig("androidDownloadUrl", "https://github.com/quweqw/AI-Food/releases"),
  githubUrl: readConfig("githubUrl", "https://github.com/quweqw/AI-Food"),
  chatPreset: readConfig(
    "chatPreset",
    "Ты - AI Food, помощник по питанию. Отвечай конкретно, учитывай цель, калории, аллергены и исключенные продукты.",
  ),
  requestTimeoutMs: 45000,
};

function readConfig(key, fallback) {
  return localStorage.getItem(`cremenality_${key}`) || window.CREMENALITY_CONFIG?.[key] || fallback;
}
