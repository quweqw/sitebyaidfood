const config = window.AIFOOD_WEB_CONFIG || {};
const authApiBaseUrl = (config.authApiBaseUrl || "https://api.cremenality.ru").replace(/\/$/, "");
const defaultSettings = {
  email: "",
  name: "",
  age: 25,
  gender: "male",
  height: 175,
  weight: 70,
  activity_level: "moderate",
  daily_calories: 2000,
  diet_type: "normal",
  meals_per_day: 3,
  allergens: [],
  favorite_products: [],
  disliked_products: [],
  excluded_products: [],
};

const state = {
  user: null,
  coreToken: "",
  settings: { ...defaultSettings },
  connection: {
    mode: "radmin",
    coreApiUrl: "http://26.192.1.120:8000",
    confirmed: false,
  },
  connectionInfo: null,
  currentPlan: null,
  selectedPlanDay: 1,
  chats: [],
  currentChatId: "",
  pendingIntent: null,
  busy: false,
};

const elements = {
  authGate: document.querySelector("#authGate"),
  connectionGate: document.querySelector("#connectionGate"),
  appShell: document.querySelector("#appShell"),
  authGateStatus: document.querySelector("#authGateStatus"),
  retryAuthButton: document.querySelector("#retryAuthButton"),
  connectionEmail: document.querySelector("#connectionEmail"),
  vpnGrid: document.querySelector("#vpnGrid"),
  connectionDetails: document.querySelector("#connectionDetails"),
  openChatButton: document.querySelector("#openChatButton"),
  refreshConnectionButton: document.querySelector("#refreshConnectionButton"),
  userEmail: document.querySelector("#userEmail"),
  messages: document.querySelector("#messages"),
  suggestions: document.querySelector("#suggestions"),
  chatForm: document.querySelector("#chatForm"),
  messageInput: document.querySelector("#messageInput"),
  newChatButton: document.querySelector("#newChatButton"),
  clearHistoryButton: document.querySelector("#clearHistoryButton"),
  historyList: document.querySelector("#historyList"),
  openPhotoButton: document.querySelector("#openPhotoButton"),
  photoInput: document.querySelector("#photoInput"),
  intentPanel: document.querySelector("#intentPanel"),
  intentText: document.querySelector("#intentText"),
  settingsForm: document.querySelector("#settingsForm"),
  settingsStatus: document.querySelector("#settingsStatus"),
  calculateCaloriesButton: document.querySelector("#calculateCaloriesButton"),
  plannerForm: document.querySelector("#plannerForm"),
  latestPlanButton: document.querySelector("#latestPlanButton"),
  planOutput: document.querySelector("#planOutput"),
};

init();

async function init() {
  bindEvents();
  loadConnection();
  await hydrateAuth();
}

function bindEvents() {
  document.querySelectorAll("[data-view-button]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.viewButton));
  });
  document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.addEventListener("click", () => sendMessage(button.dataset.prompt));
  });
  document.querySelectorAll("[data-back-site]").forEach((link) => {
    link.href = config.accountUrl || "https://cremenality.ru/#account";
  });
  document.querySelectorAll("[data-open-connection]").forEach((button) => {
    button.addEventListener("click", () => showConnectionGate(true));
  });
  elements.vpnGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-provider]");
    if (button) selectConnectionProvider(button.dataset.provider);
  });
  elements.openChatButton.addEventListener("click", openConnectedChat);
  elements.refreshConnectionButton.addEventListener("click", () => showConnectionGate(true));
  elements.retryAuthButton.addEventListener("click", hydrateAuth);
  if (elements.newChatButton) elements.newChatButton.addEventListener("click", newChat);
  elements.clearHistoryButton.addEventListener("click", clearHistory);
  elements.chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage(elements.messageInput.value);
  });
  elements.openPhotoButton.addEventListener("click", () => elements.photoInput.click());
  elements.photoInput.addEventListener("change", onPhotoSelected);
  elements.intentPanel.addEventListener("click", (event) => {
    const button = event.target.closest("[data-intent-action]");
    if (button) confirmIntent(button.dataset.intentAction);
  });
  elements.settingsForm.addEventListener("submit", saveSettings);
  elements.calculateCaloriesButton.addEventListener("click", calculateCalories);
  elements.plannerForm.addEventListener("submit", generatePlanFromForm);
  elements.latestPlanButton.addEventListener("click", loadLatestPlan);
}

async function hydrateAuth() {
  setGateStatus("Проверяю сессию...");
  try {
    const user = await loadAuthenticatedUser();
    state.user = user;
    state.settings = { ...state.settings, email: user.email, ...(user.profile || {}) };
    elements.userEmail.textContent = user.email;
    elements.connectionEmail.textContent = user.email;
    loadLocalState();
    fillSettingsForm();
    renderChat();
    renderHistory();
    setGateStatus("");
    if (needsConnectionGate()) {
      await showConnectionGate();
    } else {
      showAppShell();
    }
  } catch {
    state.user = null;
    elements.authGate.hidden = false;
    elements.connectionGate.hidden = true;
    elements.appShell.hidden = true;
    setGateStatus("Активная сессия не найдена.");
  }
}

async function loadAuthenticatedUser() {
  try {
    return await authRequest("/auth/me");
  } catch (error) {
    if (![401, 403].includes(error.status)) throw error;
    const refreshed = await authRequest("/auth/refresh", {
      method: "POST",
      headers: { "X-AI-Food-Client": "native" },
      body: {},
    });
    if (refreshed.access_token) state.coreToken = refreshed.access_token;
    if (refreshed.user) return refreshed.user;
    return authRequest("/auth/me");
  }
}

async function logout() {
  try {
    await authRequest("/auth/logout", { method: "POST" });
  } finally {
    state.user = null;
    state.coreToken = "";
    elements.appShell.hidden = true;
    elements.connectionGate.hidden = true;
    elements.authGate.hidden = false;
  }
}

function showAppShell() {
  elements.authGate.hidden = true;
  elements.connectionGate.hidden = true;
  elements.appShell.hidden = false;
  renderChat();
  setView("chat");
}

async function showConnectionGate(forceRefresh = false) {
  elements.authGate.hidden = true;
  elements.appShell.hidden = true;
  elements.connectionGate.hidden = false;
  elements.openChatButton.disabled = true;
  elements.connectionDetails.innerHTML = `<p class="status-line">Загружаю данные подключения...</p>`;
  if (forceRefresh) state.connectionInfo = null;
  await loadConnectionInfo();
  const defaultProvider = state.connection.mode || state.connectionInfo?.default_provider || "radmin";
  selectConnectionProvider(defaultProvider);
}

function needsConnectionGate() {
  return !state.connection.confirmed || !state.connection.coreApiUrl;
}

async function loadConnectionInfo() {
  if (state.connectionInfo) return state.connectionInfo;
  try {
    state.connectionInfo = await authRequest("/connection-info");
  } catch {
    state.connectionInfo = fallbackConnectionInfo();
  }
  return state.connectionInfo;
}

function fallbackConnectionInfo() {
  return {
    default_provider: "radmin",
    providers: [
      {
        id: "radmin",
        title: "RadminVPN",
        badge: "VPN",
        recommended: true,
        core_api_url: "http://26.192.1.120:8000",
        fields: [
          { label: "IP ПК", value: "26.192.1.120" },
          { label: "Логин", value: "aifoodwebapp" },
          { label: "Пароль", value: "[Задай secret CONNECTION_RADMIN_PASSWORD]", secret: true },
        ],
        steps: [
          "Открой RadminVPN и подключись к сети AI Food.",
          "Убедись, что backend на ПК запущен на 0.0.0.0:8000.",
          "Убедись, что Windows Firewall пропускает входящие TCP 8000 для RadminVPN.",
          "После подключения нажми «Я подключился, открыть чат».",
        ],
        note: "HTTPS-сайт может заблокировать HTTP-запрос к 26.192.1.120:8000. Если чат не отправляет сообщения, понадобится HTTPS-домен для Radmin backend.",
      },
    ],
  };
}

function selectConnectionProvider(providerId) {
  const providers = state.connectionInfo?.providers || [];
  const provider = providers.find((item) => item.id === providerId) || providers.find((item) => item.recommended) || providers[0];
  if (!provider) return;
  state.connection.mode = provider.id;
  state.connection.coreApiUrl = String(provider.core_api_url || "").trim().replace(/\/$/, "");
  document.querySelectorAll("[data-provider]").forEach((button) => {
    button.classList.toggle("active", button.dataset.provider === provider.id);
  });
  renderConnectionDetails(provider);
}

function renderConnectionDetails(provider) {
  const fields = (provider.fields || []).map((field) => `
    <div class="connection-field">
      <span>${escapeHtml(field.label)}</span>
      <strong>${escapeHtml(field.value || "-")}</strong>
    </div>
  `).join("");
  const steps = (provider.steps || []).map((step) => `<li>${escapeHtml(step)}</li>`).join("");
  const joinLink = provider.join_url
    ? `<a class="inline-vpn-link" href="${escapeHtml(provider.join_url)}" target="_blank" rel="noreferrer">Открыть установку</a>`
    : "";
  elements.connectionDetails.innerHTML = `
    <div class="connection-detail-head">
      <span>${escapeHtml(provider.badge || "VPN")}</span>
      <h2>${escapeHtml(provider.title)}</h2>
    </div>
    <div class="connection-fields">${fields}</div>
    <ol class="connection-steps">${steps}</ol>
    <p class="connection-note">${escapeHtml(provider.note || "")}</p>
    ${joinLink}
  `;
  elements.openChatButton.disabled = !state.connection.coreApiUrl || state.connection.coreApiUrl.includes("[");
}

function openConnectedChat() {
  if (!state.connection.coreApiUrl || state.connection.coreApiUrl.includes("[")) {
    elements.connectionDetails.insertAdjacentHTML("beforeend", `<p class="status-line error">Сначала нужно заполнить реальные данные подключения в Auth Worker.</p>`);
    return;
  }
  state.connection.confirmed = true;
  persistConnection();
  showAppShell();
}

async function authRequest(path, options = {}) {
  const response = await fetch(`${authApiBaseUrl}${path}`, {
    method: options.method || "GET",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await parseResponse(response);
  if (!response.ok) throw apiError(response.status, body);
  return body;
}

async function coreRequest(path, options = {}) {
  const baseUrl = state.connection.coreApiUrl.replace(/\/$/, "");
  if (!baseUrl) throw new Error("Сначала укажите адрес локального backend.");
  const token = await getCoreToken();
  const isFormData = options.body instanceof FormData;
  const requestOptions = {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-AI-Food-Client": "native",
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {}),
    },
    body: isFormData ? options.body : options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeoutMs || config.requestTimeoutMs || 120000),
  };
  let response = await fetch(`${baseUrl}${path}`, requestOptions);
  if (response.status === 401) {
    state.coreToken = "";
    requestOptions.headers.Authorization = `Bearer ${await getCoreToken()}`;
    response = await fetch(`${baseUrl}${path}`, requestOptions);
  }
  const body = await parseResponse(response);
  if (!response.ok) throw apiError(response.status, body);
  return body;
}

async function getCoreToken() {
  if (state.coreToken) return state.coreToken;
  const response = await authRequest("/auth/refresh", {
    method: "POST",
    headers: { "X-AI-Food-Client": "native" },
    body: {},
  });
  state.coreToken = response.access_token || "";
  if (!state.coreToken) throw new Error("Auth API не вернул токен для локального backend.");
  return state.coreToken;
}

async function sendMessage(rawText) {
  const text = String(rawText || "").trim();
  if (!text || state.busy) return;
  ensureCurrentChat();
  addMessage({ text, isUser: true });
  elements.messageInput.value = "";
  renderChat();

  if (await maybeHandleMealIntent(text)) return;

  const pendingIndex = addMessage({ text: "Думаю...", isUser: false, isLoading: true });
  state.busy = true;
  renderChat();
  try {
    const response = await coreRequest("/chat/message", {
      method: "POST",
      body: chatPayload(text),
      timeoutMs: 120000,
    });
    replaceMessage(pendingIndex, { text: response.response || "Модель не вернула ответ.", isUser: false });
  } catch (error) {
    replaceMessage(pendingIndex, { text: connectionErrorText(error), isUser: false, kind: "error" });
  } finally {
    state.busy = false;
    persistChats();
    renderChat();
  }
}

async function maybeHandleMealIntent(text) {
  try {
    const intent = await coreRequest("/meal-planner/intent/parse", {
      method: "POST",
      body: {
        message: text,
        current_profile: profilePayload(),
      },
      timeoutMs: 45000,
    });
    if (!intent || intent.intent === "unknown" || !intent.requires_confirmation) return false;
    state.pendingIntent = intent;
    elements.intentText.textContent = intent.confirmation_message || "Как применить параметры рациона?";
    elements.intentPanel.hidden = false;
    return true;
  } catch {
    return false;
  }
}

async function confirmIntent(action) {
  const intent = state.pendingIntent;
  state.pendingIntent = null;
  elements.intentPanel.hidden = true;
  if (!intent || action === "reject") {
    addMessage({ text: "Ок, не меняю рацион.", isUser: false });
    renderChat();
    return;
  }
  const pendingIndex = addMessage({ text: "Готовлю рацион...", isUser: false, isLoading: true });
  renderChat();
  try {
    if (intent.intent === "generate_meal_plan") {
      const plan = await coreRequest("/meal-planner/generate", {
        method: "POST",
        body: planRequestFromIntent(intent, action === "save_to_profile"),
        timeoutMs: 180000,
      });
      replaceMessage(pendingIndex, { text: planReadyText(plan, action === "save_to_profile"), isUser: false });
      renderPlan(plan);
      setView("planner");
    } else if (intent.intent === "suggest_dinner") {
      const result = await coreRequest("/meal-planner/dinner-suggestion", {
        method: "POST",
        body: suggestionRequestFromIntent(intent),
        timeoutMs: 120000,
      });
      replaceMessage(pendingIndex, { text: suggestionsText(result.suggestions || []), isUser: false });
    }
  } catch (error) {
    replaceMessage(pendingIndex, { text: connectionErrorText(error), isUser: false, kind: "error" });
  } finally {
    persistChats();
    renderChat();
  }
}

async function onPhotoSelected() {
  const file = elements.photoInput.files?.[0];
  elements.photoInput.value = "";
  if (!file) return;
  ensureCurrentChat();
  const imageUrl = URL.createObjectURL(file);
  addMessage({ text: "Фото", isUser: true, kind: "image", imageUrl });
  const pendingIndex = addMessage({ text: "Анализирую фото...", isUser: false, isLoading: true });
  renderChat();
  const formData = new FormData();
  formData.append("file", file, file.name || "food.jpg");
  formData.append("age", String(state.settings.age));
  formData.append("gender", state.settings.gender);
  formData.append("height", String(state.settings.height));
  formData.append("weight", String(state.settings.weight));
  formData.append("diet_type", state.settings.diet_type);
  formData.append("daily_calories", String(state.settings.daily_calories));
  formData.append("allergens", state.settings.allergens.join(","));
  formData.append("excluded_products", state.settings.excluded_products.join(","));
  formData.append("favorite_products", state.settings.favorite_products.join(","));
  formData.append("disliked_products", state.settings.disliked_products.join(","));
  try {
    const result = await coreRequest("/recognition/image", {
      method: "POST",
      body: formData,
      timeoutMs: 120000,
    });
    replaceMessage(pendingIndex, {
      text: "Распознавание готово",
      isUser: false,
      kind: "recognition",
      metadata: result,
    });
  } catch (error) {
    replaceMessage(pendingIndex, { text: `Ошибка распознавания: ${connectionErrorText(error)}`, isUser: false, kind: "error" });
  } finally {
    persistChats();
    renderChat();
  }
}

function chatPayload(message) {
  return {
    message,
    history: currentMessages()
      .slice(0, -1)
      .filter((messageItem) => messageItem.kind === "text" || !messageItem.kind)
      .slice(-12)
      .map((messageItem) => ({
        role: messageItem.isUser ? "user" : "assistant",
        content: messageItem.text,
      })),
    allergens: state.settings.allergens,
    favorite_products: state.settings.favorite_products,
    disliked_products: state.settings.disliked_products,
    excluded_products: state.settings.excluded_products,
    daily_calories: Number(state.settings.daily_calories) || 2000,
    diet_type: state.settings.diet_type,
    age: Number(state.settings.age) || 25,
    gender: state.settings.gender,
    height: Number(state.settings.height) || 175,
    weight: Number(state.settings.weight) || 70,
  };
}

function profilePayload() {
  const goalMap = { normal: "balanced", cut: "weight_loss", bulk: "muscle_gain" };
  return {
    target_calories: state.settings.daily_calories,
    daily_calories: state.settings.daily_calories,
    goal: goalMap[state.settings.diet_type] || "balanced",
    diet_type: state.settings.diet_type,
    meals_per_day: state.settings.meals_per_day,
    allergies: state.settings.allergens,
    excluded: state.settings.excluded_products,
    preferred: state.settings.favorite_products,
    disliked: state.settings.disliked_products,
  };
}

function planRequestFromIntent(intent, saveToProfile) {
  const params = intent.extracted_parameters || {};
  const peopleCount = numberParam(params.people_count, 1);
  const servings = numberParam(params.servings, peopleCount > 1 ? peopleCount : 1);
  return {
    days: numberParam(params.days, 7),
    meals_per_day: numberParam(params.meals_per_day, state.settings.meals_per_day),
    goal: params.goal || goalForDiet(),
    target_calories: numberParam(params.target_calories, state.settings.daily_calories),
    servings,
    people_count: peopleCount,
    portion_mode: servings > 1 || peopleCount > 1 ? "cook_for_people" : "single_user",
    temporary_overrides: temporaryOverrides(params),
    save_to_profile: saveToProfile,
  };
}

function suggestionRequestFromIntent(intent) {
  const params = intent.extracted_parameters || {};
  const peopleCount = numberParam(params.people_count, 1);
  const servings = numberParam(params.servings, peopleCount > 1 ? peopleCount : 1);
  return {
    meal_type: params.meal_type || "dinner",
    target_calories: numberParam(params.target_calories, 600),
    servings,
    people_count: peopleCount,
    ingredients_available: params.ingredients_available || [],
    temporary_overrides: temporaryOverrides(params),
  };
}

function temporaryOverrides(params) {
  return {
    ...(params.target_calories ? { target_calories: numberParam(params.target_calories, 0) } : {}),
    ...(params.goal ? { goal: params.goal } : {}),
    ...(params.meals_per_day ? { meals_per_day: numberParam(params.meals_per_day, 3) } : {}),
    excluded: params.excluded_ingredients || params.excluded || state.settings.excluded_products,
    preferred: params.preferred_ingredients || params.preferred || state.settings.favorite_products,
    disliked: params.disliked_ingredients || params.disliked || state.settings.disliked_products,
    allergies: params.allergies || params.allergens || state.settings.allergens,
  };
}

async function generatePlanFromForm(event) {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(elements.plannerForm).entries());
  elements.planOutput.textContent = "Генерирую рацион...";
  try {
    const plan = await coreRequest("/meal-planner/generate", {
      method: "POST",
      body: {
        days: numberParam(values.days, 7),
        meals_per_day: numberParam(values.meals_per_day, 3),
        goal: values.goal,
        target_calories: numberParam(values.target_calories, 2000),
        servings: numberParam(values.servings, 1),
        people_count: numberParam(values.people_count, 1),
        portion_mode: Number(values.people_count) > 1 || Number(values.servings) > 1 ? "cook_for_people" : "single_user",
        temporary_overrides: profileTemporaryOverrides(),
        save_to_profile: false,
      },
      timeoutMs: 180000,
    });
    renderPlan(plan);
  } catch (error) {
    elements.planOutput.textContent = connectionErrorText(error);
  }
}

async function loadLatestPlan() {
  elements.planOutput.textContent = "Загружаю последний рацион...";
  try {
    renderPlan(await coreRequest("/meal-planner/latest", { timeoutMs: 60000 }));
  } catch (error) {
    elements.planOutput.textContent = connectionErrorText(error);
  }
}

async function calculateCalories() {
  setSettingsStatus("Рассчитываю...");
  syncSettingsFromForm();
  try {
    const goalMap = { normal: "balanced", cut: "weight_loss", bulk: "muscle_gain" };
    const result = await coreRequest("/profile/calculate-calories", {
      method: "POST",
      body: {
        sex: state.settings.gender,
        age: Number(state.settings.age),
        height_cm: Number(state.settings.height),
        weight_kg: Number(state.settings.weight),
        activity_level: state.settings.activity_level,
        goal: goalMap[state.settings.diet_type] || "balanced",
      },
      timeoutMs: 60000,
    });
    const calories = result.target_calories || result.daily_calories;
    if (calories) {
      state.settings.daily_calories = Number(calories);
      fillSettingsForm();
      persistSettings();
    }
    setSettingsStatus(`Калорий в день: ${calories || "не рассчитано"}`);
  } catch (error) {
    setSettingsStatus(connectionErrorText(error), true);
  }
}

async function saveSettings(event) {
  event.preventDefault();
  syncSettingsFromForm();
  persistSettings();
  setSettingsStatus("Сохраняю локально и на backend...");
  try {
    await coreRequest("/profile", {
      method: "PUT",
      body: backendProfilePayload(),
      timeoutMs: 60000,
    });
    setSettingsStatus("Профиль сохранен.");
  } catch (error) {
    setSettingsStatus(`Локально сохранено. Backend: ${connectionErrorText(error)}`, true);
  }
}

function setView(name) {
  document.querySelectorAll(".app-view").forEach((view) => {
    view.classList.toggle("active", view.dataset.view === name);
  });
  document.querySelectorAll("[data-view-button]").forEach((button) => {
    button.classList.toggle("active", button.dataset.viewButton === name);
  });
  if (name === "history") renderHistory();
}

function loadLocalState() {
  state.settings = { ...defaultSettings, ...readJsonStorage(settingsKey(), {}), email: state.user.email };
  state.connection = { ...state.connection, ...readJsonStorage("aifood_web_connection", {}) };
  const chats = readJsonStorage(chatsKey(), []);
  state.chats = Array.isArray(chats) ? chats.filter((chat) => Array.isArray(chat.messages)) : [];
  state.currentChatId = state.chats.at(-1)?.id || newId();
}

function ensureCurrentChat() {
  if (!state.currentChatId) state.currentChatId = newId();
  if (!state.chats.some((chat) => chat.id === state.currentChatId)) {
    state.chats.push({ id: state.currentChatId, messages: [] });
  }
}

function currentChat() {
  ensureCurrentChat();
  return state.chats.find((chat) => chat.id === state.currentChatId);
}

function currentMessages() {
  return currentChat().messages;
}

function addMessage(message) {
  const chat = currentChat();
  chat.messages.push({ kind: "text", ...message, isLoading: Boolean(message.isLoading) });
  persistChats();
  return chat.messages.length - 1;
}

function replaceMessage(index, message) {
  const chat = currentChat();
  chat.messages[index] = { kind: "text", ...message, isLoading: false };
  persistChats();
}

function newChat() {
  state.currentChatId = newId();
  ensureCurrentChat();
  persistChats();
  renderChat();
  renderHistory();
  setView("chat");
}

function clearHistory() {
  if (!window.confirm("Очистить историю чатов?")) return;
  state.chats = [];
  state.currentChatId = newId();
  persistChats();
  renderChat();
  renderHistory();
}

function renderChat() {
  ensureCurrentChat();
  elements.messages.textContent = "";
  const messages = currentMessages();
  elements.suggestions.hidden = messages.length > 0 || state.busy;
  messages.forEach((message) => elements.messages.append(messageNode(message)));
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function messageNode(message) {
  const item = document.createElement("article");
  item.className = `message ${message.isUser ? "user" : "assistant"} ${message.kind === "image" ? "image-message" : ""} ${message.kind === "error" ? "error" : ""}`;
  if (message.kind === "image" && message.imageUrl) {
    const image = document.createElement("img");
    image.src = message.imageUrl;
    image.alt = "Фото еды";
    item.append(image);
  }
  if (message.kind === "recognition") {
    item.append(recognitionNode(message.metadata || {}));
    return item;
  }
  const text = document.createElement("p");
  text.textContent = message.text || "";
  if (message.isLoading) text.className = "loading-text";
  item.append(text);
  return item;
}

function recognitionNode(data) {
  const wrap = document.createElement("div");
  wrap.className = "recognition-card";
  const meal = data.meal || "Блюдо";
  const nutrition = data.nutrition || {};
  const confidence = Number(data.confidence ?? data.score ?? 0);
  wrap.innerHTML = `
    <div class="recognition-head">
      <div>
        <div class="recognition-kicker">Я распознал блюдо</div>
        <div class="recognition-title">${escapeHtml(meal)}</div>
      </div>
      ${confidence ? `<div class="confidence-badge"><span>✦</span>${Math.round(confidence * 100)}%</div>` : ""}
    </div>
    <div class="section-title">КБЖУ, примерно на 100 г</div>
    <div class="macro-row">
      <div class="macro-tile"><strong>${round(nutrition.calories)}</strong><small>Ккал</small></div>
      <div class="macro-tile"><strong>${round(nutrition.protein)} г</strong><small>Белки</small></div>
      <div class="macro-tile"><strong>${round(nutrition.fat)} г</strong><small>Жиры</small></div>
      <div class="macro-tile"><strong>${round(nutrition.carbs)} г</strong><small>Углеводы</small></div>
    </div>
  `;
  const ingredients = listFrom(data.ingredients);
  if (ingredients.length) {
    const title = document.createElement("div");
    title.className = "section-title";
    title.textContent = "Что видно на фото";
    const list = document.createElement("div");
    list.className = "ingredient-list";
    ingredients.slice(0, 12).forEach((ingredient) => {
      const pill = document.createElement("span");
      pill.className = "ingredient-pill";
      pill.textContent = ingredient;
      list.append(pill);
    });
    wrap.append(title, list);
  }
  const recipe = data.recipe || {};
  const steps = listFrom(recipe.instructions || recipe.steps);
  if (steps.length) {
    const title = document.createElement("div");
    title.className = "section-title";
    title.textContent = "Быстрый рецепт";
    const ol = document.createElement("ol");
    ol.className = "recipe-steps";
    steps.slice(0, 6).forEach((step) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${ol.children.length + 1}.</span><span>${escapeHtml(step)}</span>`;
      ol.append(li);
    });
    wrap.append(title, ol);
  }
  const tips = String(recipe.tips || data.tips || "").trim();
  if (tips) {
    const tip = document.createElement("p");
    tip.className = "recipe-meta";
    tip.textContent = tips;
    wrap.append(tip);
  }
  const suggestions = Array.isArray(data.suggestions) ? data.suggestions.slice(0, 3) : [];
  if (suggestions.length) {
    const title = document.createElement("div");
    title.className = "section-title";
    title.textContent = "Похожие рецепты";
    const list = document.createElement("div");
    list.className = "similar-list";
    suggestions.forEach((suggestion) => {
      const nutritionForUser = suggestion.nutrition_for_user || suggestion.nutrition || {};
      const item = document.createElement("div");
      item.className = "similar-item";
      item.innerHTML = `
        <span>
          <strong>${escapeHtml(suggestion.name || "Рецепт")}</strong>
          <small class="meal-meta">${round(nutritionForUser.calories)} ккал  Б ${round(nutritionForUser.protein)} г  Ж ${round(nutritionForUser.fat)} г  У ${round(nutritionForUser.carbs)} г</small>
        </span>
        <strong>›</strong>
      `;
      list.append(item);
    });
    wrap.append(title, list);
  }
  return wrap;
}

function renderHistory() {
  elements.historyList.textContent = "";
  const history = state.chats.filter((chat) => chat.messages.length).toReversed();
  if (!history.length) {
    elements.historyList.textContent = "История пуста.";
    return;
  }
  history.forEach((chat) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-item";
    button.textContent = chatTitle(chat);
    button.addEventListener("click", () => {
      state.currentChatId = chat.id;
      renderChat();
      setView("chat");
    });
    elements.historyList.append(button);
  });
}

function renderPlan(plan) {
  state.currentPlan = plan;
  elements.planOutput.textContent = "";
  if (!plan || !Array.isArray(plan.days)) {
    elements.planOutput.textContent = "Рацион пуст.";
    return;
  }
  if (!plan.days.some((day) => Number(day.day) === Number(state.selectedPlanDay))) {
    state.selectedPlanDay = Number(plan.days[0]?.day || 1);
  }
  const selectedDay = plan.days.find((day) => Number(day.day) === Number(state.selectedPlanDay)) || plan.days[0];
  const macros = selectedDay.macro_summary || selectedDay.macros || {};
  const progress = plan.progress || {};

  const summary = document.createElement("section");
  summary.className = "plan-summary";
  summary.innerHTML = `
    <div class="recognition-head">
      <h2>День ${selectedDay.day || 1}</h2>
      <span class="meal-meta">оценка ${scoreText(selectedDay.score)}</span>
    </div>
    <div class="summary-grid">
      <div class="summary-row"><span>Калории</span><strong>${round(macros.calories || selectedDay.actual_calories)} / ${round(selectedDay.target_calories || plan.target_calories || state.settings.daily_calories)} ккал</strong></div>
      <div class="summary-row"><span>Белки</span><strong>${round(macros.protein)} г</strong></div>
      <div class="summary-row"><span>Жиры</span><strong>${round(macros.fat)} г</strong></div>
      <div class="summary-row"><span>Углеводы</span><strong>${round(macros.carbs)} г</strong></div>
    </div>
    <p class="recipe-meta">Качество: ${plan.summary?.normal || 0} нормальных, ${plan.summary?.relaxed || 0} мягких, ${plan.summary?.emergency || 0} аварийных</p>
  `;

  const progressPercent = Number(progress.completion_percent ?? progress.completionPercent ?? 0);
  const progressCard = document.createElement("section");
  progressCard.className = "plan-summary";
  progressCard.innerHTML = `
    <div class="recognition-head">
      <h2>Прогресс</h2>
      <strong>${progressPercent.toFixed(1)}%</strong>
    </div>
    <div class="progress-bar" style="--value:${Math.max(0, Math.min(100, progressPercent))}%"><span></span></div>
    <p class="recipe-meta">${progress.meals_completed || progress.mealsCompleted || 0}/${progress.meals_total || progress.mealsTotal || 0} блюд отмечено • день ${progress.current_day || progress.currentDay || selectedDay.day || 1}/${progress.days_total || progress.daysTotal || plan.days.length}</p>
  `;

  elements.planOutput.append(summary, progressCard);

  const warnings = Array.isArray(plan.warnings) ? plan.warnings : [];
  if (warnings.length) {
    const warningCard = document.createElement("section");
    warningCard.className = "plan-summary warning-card";
    warningCard.innerHTML = `<p class="recipe-meta">ⓘ ${escapeHtml(warnings.join("\n"))}</p>`;
    elements.planOutput.append(warningCard);
  }

  const tabs = document.createElement("nav");
  tabs.className = "day-tabs";
  plan.days.forEach((day) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = Number(day.day) === Number(selectedDay.day) ? "active" : "";
    button.textContent = `${Number(day.day) === Number(selectedDay.day) ? "✓ " : ""}День ${day.day}`;
    button.addEventListener("click", () => {
      state.selectedPlanDay = Number(day.day);
      renderPlan(state.currentPlan);
    });
    tabs.append(button);
  });

  const mealList = document.createElement("section");
  mealList.className = "meal-list";
  (selectedDay.meals || []).forEach((meal) => {
    const nutrition = meal.nutrition_for_user || meal.nutrition || {};
    const checked = meal.progress?.checked || meal.progress?.status === "eaten";
    const item = document.createElement("article");
    item.className = "meal-card";
    item.innerHTML = `
      <span class="meal-check ${checked ? "checked" : ""}">${checked ? "✓" : ""}</span>
      <span>
        <strong class="meal-title">${escapeHtml(meal.name || "Блюдо")}</strong>
        <small class="meal-meta">${mealTypeLabel(meal.meal_type)} • ${round(nutrition.calories)} ккал • Б ${round(nutrition.protein)} / Ж ${round(nutrition.fat)} / У ${round(nutrition.carbs)}</small>
        ${meal.main_carb ? `<small class="meal-meta">углевод: ${escapeHtml(meal.main_carb)}</small>` : ""}
      </span>
      <span class="tier-badge">${escapeHtml(tierLabel(meal.tier))}</span>
    `;
    mealList.append(item);
  });

  elements.planOutput.append(tabs, mealList);
}

function fillSettingsForm() {
  const form = elements.settingsForm;
  form.name.value = state.settings.name || "";
  form.age.value = state.settings.age || 25;
  form.gender.value = state.settings.gender || "male";
  form.activity_level.value = state.settings.activity_level || "moderate";
  form.height.value = state.settings.height || 175;
  form.weight.value = state.settings.weight || 70;
  form.daily_calories.value = state.settings.daily_calories || 2000;
  form.diet_type.value = state.settings.diet_type || "normal";
  form.meals_per_day.value = state.settings.meals_per_day || 3;
  form.allergens.value = state.settings.allergens.join(", ");
  form.favorite_products.value = state.settings.favorite_products.join(", ");
  form.disliked_products.value = state.settings.disliked_products.join(", ");
  form.excluded_products.value = state.settings.excluded_products.join(", ");
}

function syncSettingsFromForm() {
  const form = elements.settingsForm;
  state.settings = {
    ...state.settings,
    name: form.name.value.trim(),
    age: numberParam(form.age.value, 25),
    gender: form.gender.value,
    activity_level: form.activity_level.value,
    height: numberParam(form.height.value, 175),
    weight: Number(form.weight.value) || 70,
    daily_calories: numberParam(form.daily_calories.value, 2000),
    diet_type: form.diet_type.value,
    meals_per_day: numberParam(form.meals_per_day.value, 3),
    allergens: csv(form.allergens.value),
    favorite_products: csv(form.favorite_products.value),
    disliked_products: csv(form.disliked_products.value),
    excluded_products: csv(form.excluded_products.value),
  };
}

function backendProfilePayload() {
  const goalMap = { normal: "balanced", cut: "weight_loss", bulk: "muscle_gain" };
  return {
    name: state.settings.name,
    age: state.settings.age,
    sex: state.settings.gender,
    height_cm: state.settings.height,
    weight_kg: state.settings.weight,
    activity_level: state.settings.activity_level,
    target_calories: state.settings.daily_calories,
    goal: goalMap[state.settings.diet_type] || "balanced",
    diet_type: state.settings.diet_type,
    meals_per_day: state.settings.meals_per_day,
    allergies: state.settings.allergens,
    preferred_ingredients: state.settings.favorite_products,
    disliked_ingredients: state.settings.disliked_products,
    excluded_ingredients: state.settings.excluded_products,
    push_notifications: false,
  };
}

function loadConnection() {
  state.connection = {
    ...state.connection,
    coreApiUrl: config.defaultCoreApiBaseUrl || "",
    ...readJsonStorage("aifood_web_connection", {}),
  };
}

function persistConnection() {
  localStorage.setItem("aifood_web_connection", JSON.stringify(state.connection));
}

function persistSettings() {
  localStorage.setItem(settingsKey(), JSON.stringify(state.settings));
}

function persistChats() {
  localStorage.setItem(chatsKey(), JSON.stringify(state.chats.map((chat) => ({
    id: chat.id,
    messages: chat.messages.filter((message) => message.kind !== "image"),
  }))));
}

function profileTemporaryOverrides() {
  return {
    target_calories: state.settings.daily_calories,
    goal: goalForDiet(),
    meals_per_day: state.settings.meals_per_day,
    excluded: state.settings.excluded_products,
    preferred: state.settings.favorite_products,
    disliked: state.settings.disliked_products,
    allergies: state.settings.allergens,
  };
}

function goalForDiet() {
  return { normal: "balanced", cut: "weight_loss", bulk: "muscle_gain" }[state.settings.diet_type] || "balanced";
}

function planReadyText(plan, saved) {
  const summary = plan.summary || {};
  return `Рацион готов: ${summary.generated_meals || 0} блюд. ${saved ? "Параметры сохранены в профиль. " : ""}Открываю экран рациона.`;
}

function suggestionsText(suggestions) {
  if (!suggestions.length) return "Не нашел безопасных вариантов для этого запроса.";
  return `Вот что можно приготовить:\n${suggestions.slice(0, 3).map((meal) => {
    const kcal = round(meal.nutrition_for_user?.calories || meal.nutrition?.calories);
    return `• ${meal.name}: ${kcal} ккал`;
  }).join("\n")}`;
}

function scoreText(value) {
  const score = Number(value);
  return Number.isFinite(score) ? score.toFixed(2) : "-";
}

function mealTypeLabel(value) {
  return {
    breakfast: "завтрак",
    lunch: "обед",
    dinner: "ужин",
    snack: "перекус",
  }[String(value || "").toLowerCase()] || String(value || "прием пищи");
}

function tierLabel(value) {
  return {
    normal: "норма",
    relaxed: "мягкий",
    emergency: "аварийный",
  }[String(value || "").toLowerCase()] || String(value || "норма");
}

function chatTitle(chat) {
  const first = chat.messages.find((message) => message.isUser && message.text);
  const text = first?.text || "Чат";
  return text.length > 48 ? `${text.slice(0, 48)}...` : text;
}

function setGateStatus(text) {
  elements.authGateStatus.textContent = text;
}

function setSettingsStatus(text, isError = false) {
  elements.settingsStatus.textContent = text;
  elements.settingsStatus.classList.toggle("error", isError);
}

function connectionErrorText(error) {
  return error?.message || "Не удалось подключиться к локальному backend.";
}

function apiError(status, body) {
  const detail = body?.detail;
  const message = detail?.error?.message || detail?.message || body?.message || `Ошибка API (${status})`;
  const error = new Error(message);
  error.status = status;
  error.body = body;
  return error;
}

async function parseResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  const text = await response.text();
  return text ? { message: text } : {};
}

function readJsonStorage(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function settingsKey() {
  return `aifood_web_settings:${state.user?.email || "anonymous"}`;
}

function chatsKey() {
  return `aifood_web_chats:${state.user?.email || "anonymous"}`;
}

function newId() {
  return String(Date.now());
}

function csv(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean).slice(0, 25);
}

function listFrom(value) {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function numberParam(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function round(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}
