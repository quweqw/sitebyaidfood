import { api } from "./api.js";
import { isAdmin, isAuthenticated, session } from "./session.js";
import { setStatus } from "./ui.js";

const adminGate = document.querySelector("#adminGate");
const adminPanel = document.querySelector("#adminPanel");
const adminStatus = document.querySelector("#adminStatus");
const usersBody = document.querySelector("#adminUsersBody");
const refreshButton = document.querySelector("#adminRefreshButton");

export function initAdmin() {
  refreshButton.addEventListener("click", loadUsers);
  window.addEventListener("routechange:local", (event) => {
    if (event.detail.route === "admin") loadUsers();
  });
  updateAdminGate();
  if (window.location.hash === "#admin") loadUsers();
}

export function updateAdminGate() {
  const allowedByTokenClaims = isAuthenticated() && isAdmin();
  adminGate.hidden = allowedByTokenClaims;
  adminPanel.hidden = !allowedByTokenClaims;
}

async function loadUsers() {
  if (!isAuthenticated()) {
    updateAdminGate();
    return;
  }

  setStatus(adminStatus, "Загружаю пользователей...");
  try {
    const response = await api.adminUsers();
    const users = Array.isArray(response) ? response : response.users || [];
    adminGate.hidden = true;
    adminPanel.hidden = false;
    renderUsers(users);
    setStatus(adminStatus, users.length ? `Загружено: ${users.length}` : "Пользователей пока нет.", "ok");
  } catch (error) {
    adminPanel.hidden = true;
    adminGate.hidden = false;
    setStatus(adminStatus, "");
    if (error.status === 403) {
      adminGate.querySelector("p").textContent = "Backend отклонил запрос: у аккаунта нет роли admin.";
    } else {
      adminGate.querySelector("p").textContent = error.message;
    }
  }
}

function renderUsers(users) {
  usersBody.textContent = "";
  users.forEach((user) => {
    const id = user.id || user.user_id || user.email;
    const blocked = Boolean(user.is_blocked ?? user.blocked);
    const row = document.createElement("tr");
    row.append(
      cell(user.email || "-"),
      cell(user.role || (user.is_admin ? "admin" : "user")),
      badgeCell(blocked ? "Заблокирован" : "Активен", blocked ? "blocked" : "active"),
      badgeCell(user.is_email_verified === false ? "Нет" : "Да", user.is_email_verified === false ? "blocked" : "active"),
      cell(formatDate(user.created_at)),
      actionsCell(id, blocked, user.email),
    );
    usersBody.append(row);
  });
}

function cell(value) {
  const td = document.createElement("td");
  td.textContent = String(value ?? "-");
  return td;
}

function badgeCell(value, type) {
  const td = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = `badge ${type}`;
  badge.textContent = value;
  td.append(badge);
  return td;
}

function actionsCell(id, blocked, email) {
  const td = document.createElement("td");
  const wrap = document.createElement("div");
  wrap.className = "admin-actions";

  const blockButton = document.createElement("button");
  blockButton.className = "mini-button";
  blockButton.type = "button";
  blockButton.textContent = blocked ? "Разблокировать" : "Заблокировать";
  blockButton.addEventListener("click", () => setBlocked(id, !blocked));

  const deleteButton = document.createElement("button");
  deleteButton.className = "mini-button danger";
  deleteButton.type = "button";
  deleteButton.textContent = "Удалить";
  deleteButton.disabled = email === session.email;
  deleteButton.title = deleteButton.disabled ? "Нельзя удалить текущий аккаунт администратора" : "";
  deleteButton.addEventListener("click", () => deleteUser(id, email));

  wrap.append(blockButton, deleteButton);
  td.append(wrap);
  return td;
}

async function setBlocked(id, blocked) {
  setStatus(adminStatus, blocked ? "Блокирую аккаунт..." : "Разблокирую аккаунт...");
  try {
    await api.setUserBlocked(id, blocked);
    await loadUsers();
  } catch (error) {
    setStatus(adminStatus, error.message, "error");
  }
}

async function deleteUser(id, email) {
  const confirmed = window.confirm(`Удалить учетную запись ${email || id}? Это действие нельзя отменить.`);
  if (!confirmed) return;
  setStatus(adminStatus, "Удаляю аккаунт...");
  try {
    await api.deleteUser(id);
    await loadUsers();
  } catch (error) {
    setStatus(adminStatus, error.message, "error");
  }
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("ru-RU");
}
