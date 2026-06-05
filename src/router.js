const views = [...document.querySelectorAll("[data-view]")];
const navLinks = [...document.querySelectorAll(".main-nav a")];
const mainNav = document.querySelector(".main-nav");

export function initRouter() {
  window.addEventListener("hashchange", route);
  document.querySelector("[data-menu-toggle]").addEventListener("click", () => mainNav.classList.toggle("open"));
  document.querySelectorAll("[data-route]").forEach((button) => {
    button.addEventListener("click", () => {
      window.location.hash = button.dataset.route;
    });
  });
  route();
}

export function route() {
  const routeName = (window.location.hash || "#home").replace("#", "");
  const selected = views.some((view) => view.dataset.view === routeName) ? routeName : "home";
  views.forEach((view) => view.classList.toggle("active", view.dataset.view === selected));
  navLinks.forEach((link) => link.classList.toggle("active", link.getAttribute("href") === `#${selected}`));
  mainNav.classList.remove("open");
  window.scrollTo({ top: 0, behavior: "auto" });
  window.dispatchEvent(new CustomEvent("routechange:local", { detail: { route: selected } }));
}
