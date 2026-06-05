const iconPaths = {
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 14.5-4 16 0"/>',
  "user-plus": '<circle cx="10" cy="8" r="4"/><path d="M3 21c1.2-4 12.8-4 14 0"/><path d="M19 8v6M16 11h6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  download: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>',
  chat: '<path d="M4 5h16v11H8l-4 4z"/>',
  camera: '<path d="M4 7h4l2-2h4l2 2h4v12H4z"/><circle cx="12" cy="13" r="3"/>',
  chart: '<path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16v-5M12 16V8M16 16v-8"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',
  shield: '<path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/><path d="M8 12l3 3 5-6"/>',
  "shield-alert": '<path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/><path d="M12 8v5"/><path d="M12 17h.01"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  server: '<rect x="4" y="4" width="16" height="6" rx="1"/><rect x="4" y="14" width="16" height="6" rx="1"/><path d="M8 7h.01M8 17h.01"/>',
  bot: '<rect x="5" y="8" width="14" height="10" rx="2"/><path d="M12 8V4M9 13h.01M15 13h.01"/>',
  database: '<ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v10c0 1.7 3.1 3 7 3s7-1.3 7-3V5"/><path d="M5 10c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  login: '<path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M15 4h4v16h-4"/>',
  logout: '<path d="M14 17l5-5-5-5"/><path d="M19 12H8"/><path d="M10 4H5v16h5"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  send: '<path d="M3 11l18-8-8 18-2-7z"/><path d="M11 14l10-11"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v6h-6"/>',
  github: '<path d="M12 2a10 10 0 0 0-3 19c.5.1.7-.2.7-.5v-2c-3 .7-3.6-1.2-3.6-1.2-.5-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 0 1.6 1 1.6 1 .9 1.5 2.4 1 3 .8.1-.6.4-1 .7-1.2-2.4-.3-4.9-1.2-4.9-5.3 0-1.2.4-2.1 1-2.9-.1-.3-.5-1.4.1-2.8 0 0 .9-.3 3 1.1A10 10 0 0 1 12 6c.9 0 1.8.1 2.6.3 2.1-1.4 3-1.1 3-1.1.6 1.4.2 2.5.1 2.8.7.8 1 1.7 1 2.9 0 4.1-2.5 5-4.9 5.3.4.3.8 1 .8 2v2.3c0 .3.2.6.8.5A10 10 0 0 0 12 2z"/>',
};

export function renderIcons() {
  document.querySelectorAll("i[data-icon]").forEach((element) => {
    const name = element.dataset.icon;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.innerHTML = iconPaths[name] || iconPaths.shield;
    element.replaceWith(svg);
  });
}
