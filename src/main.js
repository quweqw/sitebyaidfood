import { api } from "./api.js";
import { appConfig } from "./config.js";
import { initAdmin } from "./admin.js";
import { initAuth } from "./auth.js";
import { initChat } from "./chat.js";
import { initCrm } from "./crm.js";
import { renderIcons } from "./icons.js";
import { initRouter } from "./router.js";

document.querySelector("#androidDownloadLink").href = appConfig.androidDownloadUrl;
document.querySelector("#githubLink").href = appConfig.githubUrl;

renderIcons();
initRouter();
initAuth();
initChat();
initAdmin();
initCrm();
checkApiStatus();

async function checkApiStatus() {
  const element = document.querySelector("#apiStatus");
  try {
    await api.checkHealth();
    element.innerHTML = '<span class="status-dot online"></span>API online';
  } catch {
    element.innerHTML = '<span class="status-dot offline"></span>API недоступен';
  }
}
