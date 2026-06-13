import { api } from "./api.js";
import { canManageIntegration, canManagePartnerships, canManageSupport, isAuthenticated, isStaff, session } from "./session.js";
import { initTurnstile, resetTurnstile, turnstileToken } from "./turnstile.js";
import { setStatus } from "./ui.js";

const guestStorageKey = "aifood_partnership_guest_threads";
let activeThreadId = "";
let activeGuestToken = "";

export function initCrm() {
  mountRequestHistory();
  bindPartnership();
  bindSupport();
  bindAdminCrm();
  syncAccountData();
  initTurnstile();
  window.addEventListener("auth:changed", syncAccountData);
  window.addEventListener("routechange:local", (event) => {
    if (event.detail.route === "requests") {
      loadPartnershipThreads();
      loadSupportTickets();
    }
    if (event.detail.route === "admin" && isStaff()) loadActiveAdminCrmPanel();
  });
}

function mountRequestHistory() {
  const partnershipMount = document.querySelector("#requestsPartnershipMount");
  const partnershipPanel = document.querySelector("#partnershipThreadsPanel");
  const supportMount = document.querySelector("#requestsSupportMount");
  const supportTickets = document.querySelector("#supportTickets");
  if (partnershipMount && partnershipPanel) partnershipMount.append(partnershipPanel);
  if (supportMount && supportTickets) supportMount.append(supportTickets);
}

function bindPartnership() {
  const form = document.querySelector("#partnershipForm");
  const textarea = form?.elements.proposal_message;
  textarea?.addEventListener("input", () => {
    document.querySelector("#partnershipMessageCount").textContent = String(textarea.value.length);
    savePartnershipDraft(form);
  });
  form?.addEventListener("input", () => savePartnershipDraft(form));
  form?.addEventListener("submit", submitPartnership);
  document.querySelector("#partnershipRefreshButton")?.addEventListener("click", loadPartnershipThreads);
  document.querySelector("#partnershipMessageForm")?.addEventListener("submit", submitPartnershipMessage);
  restorePartnershipDraft(form);
}

function bindSupport() {
  const form = document.querySelector("#supportForm");
  const textarea = form?.elements.message;
  textarea?.addEventListener("input", () => {
    document.querySelector("#supportMessageCount").textContent = String(textarea.value.length);
  });
  form?.addEventListener("submit", submitSupportTicket);
}

function bindAdminCrm() {
  document.querySelectorAll("[data-admin-panel]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-admin-panel]").forEach((item) => item.classList.toggle("active", item === button));
      document.querySelectorAll("[data-admin-content]").forEach((panel) => {
        panel.classList.toggle("active", panel.dataset.adminContent === button.dataset.adminPanel);
      });
      setStatus(document.querySelector("#adminStatus"), "");
      loadActiveAdminCrmPanel();
    });
  });
  document.querySelector("#adminRefreshButton")?.addEventListener("click", loadActiveAdminCrmPanel);
  document.querySelector("#adminRetryCrmButton")?.addEventListener("click", retryCrmDelivery);
}

function syncAccountData() {
  const partnershipEmail = document.querySelector("#partnershipForm [name='email']");
  if (partnershipEmail && session.email) partnershipEmail.value = session.email;
  loadPartnershipThreads();
  loadSupportTickets();
}

async function submitPartnership(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.querySelector("#partnershipStatus");
  const submitButton = form.querySelector("[type='submit']");
  const values = new FormData(form);
  const payload = {
    cooperation_type: values.get("cooperation_type"),
    email: values.get("email"),
    author_name: values.get("author_name"),
    company_name: values.get("company_name"),
    subject: values.get("subject"),
    proposal_message: values.get("proposal_message"),
    preferred_contact: values.get("preferred_contact"),
    consent: values.get("consent") === "on",
    website: values.get("website"),
    turnstile_token: turnstileToken(form),
  };
  setStatus(status, "Сохраняю заявку...");
  submitButton.disabled = true;
  try {
    const response = await api.createPartnership(payload);
    if (response.guest_access_token) {
      saveGuestThread(response.thread.id, response.guest_access_token);
      activeGuestToken = response.guest_access_token;
    }
    activeThreadId = response.thread.id;
    localStorage.removeItem("aifood_partnership_draft");
    form.reset();
    document.querySelector("#partnershipMessageCount").textContent = "0";
    setStatus(
      status,
      response.email_sent === false
        ? "Заявка сохранена. Email-подтверждение временно не отправлено."
        : response.message || "Заявка отправлена, мы ответим на почту и в чате с представителем.",
      response.email_sent === false ? "error" : "ok",
    );
    window.location.hash = "#requests";
    await loadPartnershipThreads();
    await openPartnershipThread(activeThreadId, activeGuestToken);
  } catch (error) {
    setStatus(status, error.message, "error");
  } finally {
    submitButton.disabled = false;
    resetTurnstile(form);
  }
}

async function loadPartnershipThreads() {
  const panel = document.querySelector("#partnershipThreadsPanel");
  const list = document.querySelector("#partnershipThreads");
  const empty = document.querySelector("#partnershipEmptyState");
  if (!panel || !list) return;
  try {
    let threads = [];
    if (isAuthenticated()) {
      threads = (await api.partnershipThreads()).threads || [];
    } else {
      const guestThreads = readGuestThreads();
      const loaded = await Promise.allSettled(
        guestThreads.map(async (item) => (await api.partnershipThread(item.id, item.token)).thread),
      );
      threads = loaded.filter((item) => item.status === "fulfilled").map((item) => item.value);
    }
    panel.hidden = threads.length === 0;
    if (empty) empty.hidden = threads.length > 0;
    renderPartnershipThreads(threads);
  } catch {
    panel.hidden = true;
    if (empty) empty.hidden = false;
  }
}

function renderPartnershipThreads(threads) {
  const list = document.querySelector("#partnershipThreads");
  list.textContent = "";
  threads.forEach((thread) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `crm-list-item${thread.id === activeThreadId ? " active" : ""}`;
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = thread.subject;
    const meta = document.createElement("small");
    meta.textContent = `${thread.email} · ${formatDate(thread.updated_at)}`;
    copy.append(title, meta);
    const status = document.createElement("span");
    status.className = "crm-status";
    status.textContent = statusLabel(thread.status);
    button.append(copy, status);
    button.addEventListener("click", () => {
      const guest = readGuestThreads().find((item) => item.id === thread.id);
      openPartnershipThread(thread.id, guest?.token || "");
    });
    list.append(button);
  });
}

async function openPartnershipThread(threadId, guestToken = "") {
  const conversation = document.querySelector("#partnershipConversation");
  const output = document.querySelector("#partnershipMessages");
  try {
    const response = await api.partnershipThread(threadId, guestToken);
    activeThreadId = threadId;
    activeGuestToken = guestToken;
    conversation.hidden = false;
    output.textContent = "";
    response.messages.forEach((message) => output.append(messageElement(message)));
    output.scrollTop = output.scrollHeight;
    await loadPartnershipThreads();
  } catch (error) {
    conversation.hidden = false;
    output.textContent = error.message;
  }
}

async function submitPartnershipMessage(event) {
  event.preventDefault();
  if (!activeThreadId) return;
  const input = event.currentTarget.elements.message;
  const status = document.querySelector("#partnershipStatus");
  const message = input.value.trim();
  if (!message) return;
  input.disabled = true;
  try {
    await api.addPartnershipMessage(activeThreadId, message, activeGuestToken);
    input.value = "";
    setStatus(status, "");
    await openPartnershipThread(activeThreadId, activeGuestToken);
  } catch (error) {
    setStatus(status, error.message, "error");
  } finally {
    input.disabled = false;
    input.focus();
  }
}

async function submitSupportTicket(event) {
  event.preventDefault();
  const status = document.querySelector("#supportStatus");
  if (!isAuthenticated()) {
    setStatus(status, "Сначала войдите в аккаунт.", "error");
    return;
  }
  const form = event.currentTarget;
  const submitButton = form.querySelector("[type='submit']");
  const values = new FormData(form);
  setStatus(status, "Создаю обращение...");
  submitButton.disabled = true;
  try {
    const response = await api.createSupportTicket({
      category: values.get("category"),
      subject: values.get("subject"),
      message: values.get("message"),
      consent: values.get("consent") === "on",
      website: values.get("website"),
      turnstile_token: turnstileToken(form),
    });
    form.reset();
    document.querySelector("#supportMessageCount").textContent = "0";
    setStatus(
      status,
      response.email_sent === false
        ? "Обращение сохранено. Email-подтверждение временно не отправлено."
        : response.message || "Обращение создано.",
      response.email_sent === false ? "error" : "ok",
    );
    await loadSupportTickets();
  } catch (error) {
    setStatus(status, error.message, "error");
  } finally {
    submitButton.disabled = false;
    resetTurnstile(form);
  }
}

async function loadSupportTickets() {
  const list = document.querySelector("#supportTickets");
  const empty = document.querySelector("#supportEmptyState");
  if (!list) return;
  list.textContent = "";
  if (!isAuthenticated()) {
    if (empty) {
      empty.hidden = false;
      empty.textContent = "Войдите в аккаунт, чтобы увидеть обращения в поддержку.";
    }
    return;
  }
  try {
    const tickets = (await api.supportTickets()).tickets || [];
    if (empty) {
      empty.hidden = tickets.length > 0;
      empty.textContent = "Обращений в поддержку пока нет.";
    }
    tickets.forEach((ticket) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "crm-list-item";
      const copy = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = ticket.subject;
      const meta = document.createElement("small");
      meta.textContent = `${categoryLabel(ticket.category)} · ${priorityLabel(ticket.priority)} · ${formatDate(ticket.updated_at)}`;
      copy.append(title, meta);
      const status = document.createElement("span");
      status.className = "crm-status";
      status.textContent = statusLabel(ticket.status);
      item.append(copy, status);
      item.addEventListener("click", () => showSupportTicket(ticket.id, item));
      list.append(item);
    });
  } catch {
    if (empty) {
      empty.hidden = false;
      empty.textContent = "Не удалось загрузить обращения. Попробуйте обновить страницу.";
    }
    // The account page remains usable when support is temporarily unavailable.
  }
}

async function showSupportTicket(ticketId, container) {
  document.querySelectorAll("#supportTickets .crm-conversation").forEach((item) => item.remove());
  const status = document.querySelector("#supportStatus");
  let response;
  try {
    response = await api.supportTicket(ticketId);
  } catch (error) {
    setStatus(status, error.message, "error");
    return;
  }
  const conversation = document.createElement("div");
  conversation.className = "crm-conversation";
  const messages = document.createElement("div");
  messages.className = "crm-messages";
  response.messages.forEach((message) => messages.append(messageElement(message)));
  const form = document.createElement("form");
  form.className = "crm-message-form";
  const input = document.createElement("input");
  input.name = "message";
  input.maxLength = 6000;
  input.placeholder = "Дополнить обращение";
  input.required = true;
  const button = document.createElement("button");
  button.className = "button secondary compact";
  button.type = "submit";
  button.textContent = "Отправить";
  form.append(input, button);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    button.disabled = true;
    try {
      await api.addSupportMessage(ticketId, input.value);
      setStatus(status, "");
      await showSupportTicket(ticketId, container);
    } catch (error) {
      setStatus(status, error.message, "error");
    } finally {
      button.disabled = false;
    }
  });
  conversation.append(messages, form);
  container.insertAdjacentElement("afterend", conversation);
}

async function loadActiveAdminCrmPanel() {
  if (!isStaff()) return;
  const active = document.querySelector("[data-admin-panel].active")?.dataset.adminPanel;
  if (active === "partnerships" && canManagePartnerships()) await loadAdminPartnerships();
  if (active === "support" && canManageSupport()) await loadAdminSupport();
  if (active === "integration" && canManageIntegration()) await loadAdminCrmOutbox();
}

async function loadAdminPartnerships() {
  const list = document.querySelector("#adminPartnerships");
  list.textContent = "Загрузка...";
  try {
    const threads = (await api.adminPartnerships()).threads || [];
    renderAdminRecords(list, threads, "partnership");
  } catch (error) {
    list.textContent = error.message;
  }
}

async function loadAdminSupport() {
  const list = document.querySelector("#adminSupportTickets");
  list.textContent = "Загрузка...";
  try {
    const tickets = (await api.adminSupportTickets()).tickets || [];
    renderAdminRecords(list, tickets, "support");
  } catch (error) {
    list.textContent = error.message;
  }
}

async function loadAdminCrmOutbox() {
  const list = document.querySelector("#adminCrmOutbox");
  list.textContent = "Загрузка...";
  try {
    const events = (await api.adminCrmOutbox()).events || [];
    list.textContent = "";
    events.forEach((event) => {
      const item = document.createElement("article");
      item.className = "crm-list-item";
      const copy = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = `${event.event_type} · ${event.entity_type}`;
      const meta = document.createElement("small");
      meta.textContent = `${event.status} · попыток: ${event.attempts} · ${formatDate(event.updated_at)}`;
      copy.append(title, meta);
      if (event.last_error) {
        const error = document.createElement("small");
        error.className = "crm-error-text";
        error.textContent = event.last_error;
        copy.append(error);
      }
      const status = document.createElement("span");
      status.className = `crm-status ${event.status === "failed" ? "failed" : ""}`;
      status.textContent = event.status;
      item.append(copy, status);
      list.append(item);
    });
    if (!events.length) list.textContent = "Событий синхронизации пока нет.";
  } catch (error) {
    list.textContent = error.message;
  }
}

async function retryCrmDelivery() {
  const button = document.querySelector("#adminRetryCrmButton");
  const status = document.querySelector("#adminStatus");
  button.disabled = true;
  setStatus(status, "Повторяю отправку событий...");
  try {
    const result = await api.retryCrm();
    setStatus(status, `Проверено: ${result.checked || 0}, синхронизировано: ${result.synced || 0}.`, "ok");
    await loadAdminCrmOutbox();
  } catch (error) {
    setStatus(status, error.message, "error");
  } finally {
    button.disabled = false;
  }
}

function renderAdminRecords(list, records, type) {
  const adminStatus = document.querySelector("#adminStatus");
  list.textContent = "";
  records.forEach((record) => {
    const item = document.createElement("article");
    item.className = "crm-list-item";
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = record.subject;
    const meta = document.createElement("small");
    meta.textContent = `${record.email} · CRM: ${record.crm_sync_status || "pending"} · ${formatDate(record.updated_at)}`;
    copy.append(title, meta);

    const details = document.createElement("details");
    details.className = "admin-crm-thread";
    const summary = document.createElement("summary");
    summary.textContent = "Открыть переписку";
    const messages = document.createElement("div");
    messages.className = "crm-messages";
    messages.textContent = "Откройте, чтобы загрузить историю.";
    const reply = document.createElement("form");
    reply.className = "admin-crm-reply";
    const input = document.createElement("input");
    input.placeholder = "Ответ представителя";
    input.maxLength = 6000;
    input.required = true;
    const button = document.createElement("button");
    button.className = "mini-button";
    button.type = "submit";
    button.textContent = "Ответить";
    reply.append(input, button);
    details.append(summary, messages, reply);
    details.addEventListener("toggle", () => {
      if (details.open) loadAdminConversation(type, record.id, messages);
    });
    reply.addEventListener("submit", async (event) => {
      event.preventDefault();
      button.disabled = true;
      try {
        const response = type === "partnership"
          ? await api.adminReplyPartnership(record.id, input.value)
          : await api.adminReplySupport(record.id, input.value);
        input.value = "";
        setStatus(
          adminStatus,
          response.email_sent === false
            ? "Ответ сохранён, но email-уведомление отправить не удалось."
            : "Ответ сохранён и отправлен пользователю.",
          response.email_sent === false ? "error" : "ok",
        );
        await loadAdminConversation(type, record.id, messages);
      } catch (error) {
        setStatus(adminStatus, error.message, "error");
      } finally {
        button.disabled = false;
      }
    });
    copy.append(details);

    const controls = document.createElement("div");
    controls.className = "admin-crm-actions";
    const select = document.createElement("select");
    let prioritySelect = null;
    const statuses = type === "support"
      ? ["new", "in_progress", "waiting_user", "resolved", "closed"]
      : ["new", "in_progress", "waiting_user", "closed"];
    statuses.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = statusLabel(value);
      option.selected = record.status === value;
      select.append(option);
    });
    select.addEventListener("change", async () => {
      select.disabled = true;
      try {
        if (type === "partnership") await api.adminUpdatePartnership(record.id, select.value);
        else await api.adminUpdateSupport(record.id, select.value, prioritySelect?.value || record.priority || "normal");
        setStatus(adminStatus, "");
      } catch (error) {
        setStatus(adminStatus, error.message, "error");
        select.value = record.status;
      } finally {
        select.disabled = false;
      }
    });
    controls.append(select);

    if (type === "support") {
      const priority = document.createElement("select");
      prioritySelect = priority;
      ["low", "normal", "high", "urgent"].forEach((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = priorityLabel(value);
        option.selected = record.priority === value;
        priority.append(option);
      });
      priority.addEventListener("change", async () => {
        priority.disabled = true;
        try {
          await api.adminUpdateSupport(record.id, select.value, priority.value);
          setStatus(adminStatus, "Приоритет обновлён.", "ok");
        } catch (error) {
          setStatus(adminStatus, error.message, "error");
          priority.value = record.priority || "normal";
        } finally {
          priority.disabled = false;
        }
      });
      controls.append(priority);
    }

    item.append(copy, controls);
    list.append(item);
  });
  if (!records.length) list.textContent = "Записей пока нет.";
}

async function loadAdminConversation(type, id, output) {
  output.textContent = "Загрузка...";
  try {
    const response = type === "partnership"
      ? await api.partnershipThread(id)
      : await api.supportTicket(id);
    output.textContent = "";
    response.messages.forEach((message) => output.append(messageElement(message)));
    if (!response.messages.length) output.textContent = "Сообщений пока нет.";
    output.scrollTop = output.scrollHeight;
  } catch (error) {
    output.textContent = error.message;
  }
}

function messageElement(message) {
  const item = document.createElement("div");
  item.className = `crm-message ${message.sender_type === "user" ? "user" : "manager"}`;
  const text = document.createElement("span");
  text.textContent = message.message;
  const meta = document.createElement("small");
  meta.textContent = `${message.sender_name || statusLabel(message.sender_type)} · ${formatDate(message.created_at)}`;
  item.append(text, meta);
  return item;
}

function savePartnershipDraft(form) {
  if (!form) return;
  const values = Object.fromEntries(new FormData(form).entries());
  delete values.consent;
  localStorage.setItem("aifood_partnership_draft", JSON.stringify(values));
}

function restorePartnershipDraft(form) {
  if (!form) return;
  try {
    const draft = JSON.parse(localStorage.getItem("aifood_partnership_draft") || "{}");
    Object.entries(draft).forEach(([name, value]) => {
      const field = form.elements[name];
      if (!field) return;
      if (typeof RadioNodeList !== "undefined" && field instanceof RadioNodeList) field.value = value;
      else field.value = value;
    });
    document.querySelector("#partnershipMessageCount").textContent = String(form.elements.proposal_message.value.length);
  } catch {
    localStorage.removeItem("aifood_partnership_draft");
  }
}

function saveGuestThread(id, token) {
  const current = readGuestThreads().filter((item) => item.id !== id);
  current.unshift({ id, token });
  localStorage.setItem(guestStorageKey, JSON.stringify(current.slice(0, 20)));
}

function readGuestThreads() {
  try {
    return JSON.parse(localStorage.getItem(guestStorageKey) || "[]");
  } catch {
    return [];
  }
}

function statusLabel(value) {
  return {
    new: "Новое",
    in_progress: "В работе",
    waiting_user: "Ждет ответа",
    resolved: "Решено",
    closed: "Закрыто",
    user: "Пользователь",
    manager: "Представитель",
  }[value] || value || "Без статуса";
}

function categoryLabel(value) {
  return {
    account: "Аккаунт",
    ai_chat: "AI-чат",
    food_recognition: "Распознавание еды",
    bug: "Ошибка",
    other: "Другое",
    general: "Общий вопрос",
    billing: "Оплата",
    feature: "Предложение",
    privacy: "Персональные данные",
  }[value] || value || "Другое";
}

function priorityLabel(value) {
  return {
    low: "Низкий",
    normal: "Обычный",
    high: "Высокий",
    urgent: "Срочный",
  }[value] || value || "Обычный";
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || "") : date.toLocaleString("ru-RU");
}
