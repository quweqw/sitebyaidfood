import { api } from "./api.js";
import { appConfig } from "./config.js";
import { csvValue } from "./ui.js";

const messagesEl = document.querySelector("#messages");
const chatForm = document.querySelector("#chatForm");
const chatInput = document.querySelector("#chatInput");
const presetText = document.querySelector("#presetText");
const history = [];

export function initChat() {
  presetText.textContent = `Preset: ${appConfig.chatPreset}`;
  chatForm.addEventListener("submit", onChatSubmit);
}

async function onChatSubmit(event) {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;
  const payload = buildPayload(message);
  addMessage("user", message);
  history.push({ role: "user", content: message });
  chatInput.value = "";
  const pending = addMessage("assistant", "Думаю...");
  setFormDisabled(true);
  try {
    const response = await api.chatMessage(payload);
    const answer = response.response || "Модель сейчас не вернула ответ.";
    pending.querySelector("p").textContent = answer;
    history.push({ role: "assistant", content: answer });
  } catch (error) {
    pending.classList.add("error");
    pending.querySelector("p").textContent = modelErrorMessage(error);
  } finally {
    setFormDisabled(false);
    chatInput.focus();
  }
}

function buildPayload(message) {
  return {
    message,
    history: history.slice(-12),
    allergens: csvValue("#allergens"),
    favorite_products: [],
    disliked_products: [],
    excluded_products: csvValue("#excludedProducts"),
    daily_calories: numberValue("#dailyCalories", 2000),
    diet_type: document.querySelector("#dietType").value,
    age: 25,
    gender: "male",
    height: 175,
    weight: 70,
  };
}

function numberValue(selector, fallback) {
  const value = Number(document.querySelector(selector).value);
  return Number.isFinite(value) ? value : fallback;
}

function addMessage(role, text) {
  const item = document.createElement("div");
  item.className = `message ${role}`;
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  item.append(paragraph);
  messagesEl.append(item);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return item;
}

function setFormDisabled(disabled) {
  chatInput.disabled = disabled;
  chatForm.querySelector("button").disabled = disabled;
}

function modelErrorMessage(error) {
  if (error.status === 401) return "Сессия истекла. Войдите заново и повторите запрос.";
  if (error.status === 403) return "Аккаунт не имеет доступа к этой функции или заблокирован.";
  if (error.status >= 500 || error.status === 0) return "Модель сейчас недоступна. Проверьте OpenAI API и настройки Cloudflare Worker.";
  return error.message || "Не удалось получить ответ модели.";
}
