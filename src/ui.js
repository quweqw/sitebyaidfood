export function setStatus(element, message, type = "") {
  element.textContent = message;
  element.classList.remove("ok", "error");
  if (type) element.classList.add(type);
}

export function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

export function csvValue(selector) {
  const value = document.querySelector(selector).value || "";
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function escapeText(value) {
  return String(value ?? "");
}
