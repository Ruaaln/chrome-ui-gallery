const $ = (id) => document.getElementById(id);
let L = "en";

function flash(msg) {
  const s = $("status");
  s.textContent = msg;
  s.classList.add("show");
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => s.classList.remove("show"), 2800);
}

async function init() {
  const s = await getSettings();
  L = s.language;

  const sel = $("language");
  for (const [code, name] of Object.entries(LANG_NAMES)) sel.append(new Option(name, code));
  sel.value = s.language;

  $("theme").value = s.theme;
  $("autoMode").value = s.autoMode;
  $("autoStartup").checked = s.autoStartup;
  $("whitelist").value = s.whitelist.join("\n");
  $("blacklist").value = s.blacklist.join("\n");

  const { stats } = await chrome.storage.local.get("stats");
  $("statsTotal").textContent = stats?.removed || 0;

  applyI18n(L);
  applyTheme(s.theme);

  $("saveBtn").addEventListener("click", save);
  $("theme").addEventListener("change", () => applyTheme($("theme").value));
  $("language").addEventListener("change", () => applyI18n($("language").value));
}

async function save() {
  const clean = (txt) => txt
    .split(/\r?\n/)
    .map((x) => x.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0].replace(/^\./, ""))
    .filter(Boolean);

  const s = await saveSettings({
    language: $("language").value,
    theme: $("theme").value,
    autoMode: $("autoMode").value,
    autoStartup: $("autoStartup").checked,
    whitelist: clean($("whitelist").value),
    blacklist: clean($("blacklist").value)
  });

  L = s.language;
  applyI18n(L);
  applyTheme(s.theme);
  $("whitelist").value = s.whitelist.join("\n");
  $("blacklist").value = s.blacklist.join("\n");
  flash(t(L, "settingsSaved"));
}

document.addEventListener("DOMContentLoaded", init);
