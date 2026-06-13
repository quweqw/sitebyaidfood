import { api } from "./api.js";
import { canManageIntegration, canManagePartnerships, canManageSupport, canManageUsers, isAuthenticated, isStaff, session } from "./session.js";
import { setStatus } from "./ui.js";

const adminGate = document.querySelector("#adminGate");
const adminPanel = document.querySelector("#adminPanel");
const adminStatus = document.querySelector("#adminStatus");
const usersBody = document.querySelector("#adminUsersBody");
const usersSummary = document.querySelector("#adminUsersSummary");
const userSearch = document.querySelector("#adminUserSearch");
const refreshButton = document.querySelector("#adminRefreshButton");
let loadedUsers = [];

export function initAdmin() {
  refreshButton.addEventListener("click", loadUsers);
  userSearch?.addEventListener("input", renderFilteredUsers);
  window.addEventListener("auth:changed", updateAdminGate);
  window.addEventListener("routechange:local", (event) => {
    if (event.detail.route === "admin") loadUsers();
  });
  updateAdminGate();
  if (window.location.hash === "#admin") loadUsers();
}

export function updateAdminGate() {
  const allowedByTokenClaims = isAuthenticated() && isStaff();
  adminGate.hidden = allowedByTokenClaims;
  adminPanel.hidden = !allowedByTokenClaims;
  if (allowedByTokenClaims) configureStaffPanels();
}

async function loadUsers() {
  if (!isAuthenticated() || !canManageUsers()) {
    updateAdminGate();
    return;
  }

  setStatus(adminStatus, "Загружаю пользователей...");
  try {
    const response = await api.adminUsers();
    loadedUsers = Array.isArray(response) ? response : response.users || [];
    adminGate.hidden = true;
    adminPanel.hidden = false;
    renderFilteredUsers();
    setStatus(adminStatus, "");
  } catch (error) {
    adminPanel.hidden = true;
    adminGate.hidden = false;
    setStatus(adminStatus, "");
    if (error.status === 403) {
      adminGate.querySelector("p").textContent = "Backend отклонил запрос: у аккаунта нет нужных прав.";
    } else {
      adminGate.querySelector("p").textContent = error.message;
    }
  }
}

function configureStaffPanels() {
  const access = {
    users: canManageUsers(),
    partnerships: canManagePartnerships(),
    support: canManageSupport(),
    integration: canManageIntegration(),
  };
  document.querySelectorAll("[data-admin-panel]").forEach((button) => {
    button.hidden = !access[button.dataset.adminPanel];
  });
  document.querySelectorAll("[data-admin-content]").forEach((panel) => {
    panel.hidden = !access[panel.dataset.adminContent];
  });

  const active = document.querySelector("[data-admin-panel].active");
  if (!active || active.hidden) {
    document.querySelectorAll("[data-admin-panel]").forEach((button) => button.classList.remove("active"));
    document.querySelectorAll("[data-admin-content]").forEach((panel) => panel.classList.remove("active"));
    const first = [...document.querySelectorAll("[data-admin-panel]")].find((button) => !button.hidden);
    if (first) {
      first.classList.add("active");
      document.querySelector(`[data-admin-content="${first.dataset.adminPanel}"]`)?.classList.add("active");
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
      roleCell(user, id),
      badgeCell(blocked ? "Заблокирован" : "Активен", blocked ? "blocked" : "active"),
      badgeCell(user.is_email_verified === false ? "Нет" : "Да", user.is_email_verified === false ? "blocked" : "active"),
      cell(formatDate(user.created_at)),
      actionsCell(id, blocked, user.email),
    );
    usersBody.append(row);
  });
}

function renderFilteredUsers() {
  const query = String(userSearch?.value || "").trim().toLowerCase();
  const users = query
    ? loadedUsers.filter((user) => {
        const values = [
          user.email,
          user.role,
          user.is_blocked ? "заблокирован" : "активен",
          user.is_email_verified === false ? "не подтвержден" : "подтвержден",
        ];
        return values.some((value) => String(value || "").toLowerCase().includes(query));
      })
    : loadedUsers;
  renderUsers(users);
  if (usersSummary) {
    usersSummary.textContent = query
      ? `Найдено: ${users.length} из ${loadedUsers.length}`
      : `Пользователей: ${loadedUsers.length}`;
  }
}

function roleCell(user, id) {
  const td = document.createElement("td");
  const currentRole = user.role || (user.is_admin ? "admin" : "user");
  if (currentRole === "admin") {
    const badge = document.createElement("span");
    badge.className = "badge active";
    badge.textContent = "Администратор";
    td.append(badge);
    return td;
  }

  const select = document.createElement("select");
  select.className = "admin-role-select";
  const roles = {
    user: "Пользователь",
    crm_manager: "CRM-менеджер",
    support_manager: "Менеджер поддержки",
    developer: "Разработчик",
  };
  Object.entries(roles).forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = currentRole === value;
    select.append(option);
  });
  select.addEventListener("change", async () => {
    const previousRole = currentRole;
    select.disabled = true;
    setStatus(adminStatus, "Изменяю роль...");
    try {
      await api.setUserRole(id, select.value);
      await loadUsers();
    } catch (error) {
      select.value = previousRole;
      setStatus(adminStatus, error.message, "error");
    } finally {
      select.disabled = false;
    }
  });
  td.append(select);
  return td;
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
