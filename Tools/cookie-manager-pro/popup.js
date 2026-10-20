const $ = (id) => document.getElementById(id);

let settings, L = "en", tab = null, host = "", scope = "current", cookies = [];

const isWeb = (url) => !!url && /^https?:/.test(url);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function iconBtn(text, cls, title, onClick) {
  const b = el("button", "icon " + cls, text);
  b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

function setStatus(msg) {
  const s = $("status");
  s.textContent = msg;
  s.classList.add("show");
  clearTimeout(setStatus.timer);
  setStatus.timer = setTimeout(() => s.classList.remove("show"), 2800);
}

function expiryText(c) {
  if (c.session || !c.expirationDate) return "—";
  return new Date(c.expirationDate * 1000).toLocaleDateString(L);
}

function serialize(c) {
  return { name: c.name, value: c.value, domain: c.domain, path: c.path, secure: c.secure,
    httpOnly: c.httpOnly, sameSite: c.sameSite, expirationDate: c.expirationDate, session: c.session };
}

async function init() {
  settings = await getSettings();
  L = settings.language;
  applyI18n(L);
  applyTheme(settings.theme);

  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  tab = active;

  if (isWeb(tab?.url)) {
    host = hostOf(tab.url);
    $("site").textContent = host;
  } else {
    $("site").textContent = t(L, "unsupported");
    ["clearBtn", "refreshBtn", "addBtn", "saveProfileBtn", "deepBtn"].forEach((id) => ($(id).disabled = true));
  }

  bind();
  await loadCookies();
  await loadProfiles();
}

async function loadCookies() {
  if (scope === "current") {
    cookies = isWeb(tab?.url) ? await chrome.cookies.getAll({ url: tab.url }) : [];
  } else {
    cookies = await chrome.cookies.getAll({});
  }
  renderCookies();
}

function renderCookies() {
  const q = $("search").value.trim().toLowerCase();
  const items = cookies.filter((c) => !q || [c.name, c.value, c.domain].some((v) => v.toLowerCase().includes(q)));

  $("count").textContent = cookies.length;
  $("third").textContent = cookies.filter((c) => !domainMatches(host, c.domain)).length;

  const ul = $("list");
  ul.replaceChildren();
  if (!items.length) {
    ul.append(el("li", "empty", t(L, "noCookies")));
    return;
  }
  items.forEach((c) => ul.append(cookieItem(c)));
}

function cookieItem(c) {
  const li = el("li", "item");
  const info = el("div", "item-info");

  const top = el("div", "item-top");
  top.append(el("span", "item-name", c.name));
  if (c.secure) top.append(el("span", "badge", "S"));
  if (c.httpOnly) top.append(el("span", "badge", "HO"));
  if (c.sameSite && c.sameSite !== "unspecified") top.append(el("span", "badge", c.sameSite));

  const v = c.value.length > 40 ? c.value.slice(0, 40) + "…" : c.value;
  info.append(top,
    el("div", "item-meta", `${c.domain} · ${c.path} · ${expiryText(c)}`),
    el("div", "item-val", v));

  const actions = el("div", "item-actions");
  actions.append(
    iconBtn("⧉", "", t(L, "copy"), async () => {
      await navigator.clipboard.writeText(c.value);
      setStatus("✓ " + t(L, "copy"));
    }),
    iconBtn("✎", "", t(L, "edit"), () => openEditor(c)),
    iconBtn("✕", "danger", t(L, "del"), async () => {
      await removeCookies([c]);
      setStatus(t(L, "deleted", { name: c.name }));
      await loadCookies();
    })
  );

  li.append(info, actions);
  return li;
}

function openEditor(c) {
  $("dlgTitle").textContent = t(L, c ? "editTitle" : "addTitle");
  $("f_name").value = c?.name || "";
  $("f_name").readOnly = !!c;
  $("f_value").value = c?.value || "";
  $("f_domain").value = c?.domain || host;
  $("f_domain").readOnly = !!c;
  $("f_path").value = c?.path || "/";
  const days = c && !c.session && c.expirationDate
    ? Math.max(0, Math.round((c.expirationDate * 1000 - Date.now()) / 86400000))
    : 30;
  $("f_days").value = days;
  $("f_session").checked = !!c?.session;
  $("f_days").disabled = $("f_session").checked;
  $("f_secure").checked = !!c?.secure;
  $("f_httponly").checked = !!c?.httpOnly;
  $("f_samesite").value = c?.sameSite || "unspecified";
  $("editDlg").showModal();
}

async function saveEditor() {
  const name = $("f_name").value.trim();
  const domain = $("f_domain").value.trim();
  if (!name || !domain) return setStatus(t(L, "required"));

  const data = {
    name,
    value: $("f_value").value,
    domain,
    path: $("f_path").value.trim() || "/",
    secure: $("f_secure").checked,
    httpOnly: $("f_httponly").checked,
    sameSite: $("f_samesite").value
  };
  if ($("f_session").checked) data.session = true;
  else data.expirationDate = Date.now() / 1000 + (parseFloat($("f_days").value) || 30) * 86400;

  try {
    await setCookieFromData(data);
    $("editDlg").close();
    setStatus(t(L, "cookieSaved"));
    await loadCookies();
  } catch (e) {
    setStatus(e.message);
  }
}

async function clearAll() {
  if (!cookies.length) return setStatus(t(L, "deletedN", { n: 0 }));
  if (!confirm(t(L, "confirmClear"))) return;
  const n = await removeCookies(cookies);
  setStatus(t(L, "deletedN", { n }));
  await loadCookies();
}

async function refreshPage() {
  if (!tab) return;
  const btn = $("refreshBtn");
  btn.disabled = true;
  btn.classList.add("spin");
  await reloadTab(tab.id);
  btn.classList.remove("spin");
  btn.disabled = false;
  setStatus("✓ " + t(L, "refresh"));
  await loadCookies();
}

function exportJson() {
  const payload = {
    version: 2,
    host: host || "all",
    exportedAt: new Date().toISOString(),
    cookies: cookies.map(serialize)
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = el("a");
  a.href = URL.createObjectURL(blob);
  a.download = `cookies-${host || "all"}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  setStatus(t(L, "exported"));
}

async function importFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const json = JSON.parse(await file.text());
    const list = Array.isArray(json) ? json : json.cookies;
    if (!Array.isArray(list)) throw new Error("invalid");
    let n = 0;
    for (const d of list) {
      if (d && d.name && d.domain && await setCookieFromData(d).then(() => true, () => false)) n++;
    }
    setStatus(t(L, "imported", { n }));
    await loadCookies();
  } catch {
    setStatus(t(L, "importError"));
  }
  e.target.value = "";
}

async function loadProfiles() {
  const { profiles = [] } = await chrome.storage.local.get("profiles");
  const ul = $("profiles");
  ul.replaceChildren();
  if (!profiles.length) {
    ul.append(el("li", "empty", t(L, "noProfiles")));
    return;
  }
  for (const p of profiles) {
    const li = el("li", "item");
    const info = el("div", "item-info");
    info.append(
      el("span", "item-name", p.name),
      el("div", "item-meta", `${p.host} · ${p.cookies.length} · ${new Date(p.date).toLocaleDateString(L)}`)
    );
    const actions = el("div", "item-actions");
    const load = iconBtn("↻", "", "↻", () => loadProfile(p));
    load.disabled = p.host !== host;
    actions.append(
      load,
      iconBtn("✕", "danger", t(L, "del"), () => deleteProfile(p.id))
    );
    li.append(info, actions);
    ul.append(li);
  }
}

async function saveProfile() {
  if (!isWeb(tab?.url)) return;
  const name = $("profileName").value.trim() || host;
  const cs = await chrome.cookies.getAll({ url: tab.url });
  const { profiles = [] } = await chrome.storage.local.get("profiles");
  profiles.unshift({ id: crypto.randomUUID(), name, host, date: Date.now(), cookies: cs.map(serialize) });
  await chrome.storage.local.set({ profiles });
  $("profileName").value = "";
  setStatus(t(L, "profileSaved", { name }));
  loadProfiles();
}

async function loadProfile(p) {
  if (!confirm(t(L, "confirmLoad"))) return;
  await removeCookies(await chrome.cookies.getAll({ url: tab.url }));
  for (const d of p.cookies) {
    await setCookieFromData(d).catch(() => null);
  }
  await reloadTab(tab.id);
  setStatus(t(L, "profileLoaded", { name: p.name }));
  await loadCookies();
}

async function deleteProfile(id) {
  const { profiles = [] } = await chrome.storage.local.get("profiles");
  await chrome.storage.local.set({ profiles: profiles.filter((p) => p.id !== id) });
  loadProfiles();
}

function setScope(s) {
  scope = s;
  $("scopeCurrent").classList.toggle("active", s === "current");
  $("scopeAll").classList.toggle("active", s === "all");
  loadCookies();
}

function bind() {
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === b));
    $("panel-cookies").classList.toggle("hidden", b.dataset.tab !== "cookies");
    $("panel-profiles").classList.toggle("hidden", b.dataset.tab !== "profiles");
  }));

  $("scopeCurrent").addEventListener("click", () => setScope("current"));
  $("scopeAll").addEventListener("click", () => setScope("all"));
  $("search").addEventListener("input", renderCookies);

  $("addBtn").addEventListener("click", () => openEditor(null));
  $("dlgSave").addEventListener("click", saveEditor);
  $("dlgCancel").addEventListener("click", () => $("editDlg").close());
  $("f_session").addEventListener("change", () => ($("f_days").disabled = $("f_session").checked));

  $("exportBtn").addEventListener("click", exportJson);
  $("importFile").addEventListener("change", importFile);
  $("clearBtn").addEventListener("click", clearAll);
  $("refreshBtn").addEventListener("click", refreshPage);
  $("saveProfileBtn").addEventListener("click", saveProfile);

  $("deepBtn").addEventListener("click", deepClearPopup);
  $("settingsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("themeBtn").addEventListener("click", async () => {
    const order = ["system", "dark", "light"];
    const next = order[(order.indexOf(settings.theme) + 1) % order.length];
    settings = await saveSettings({ theme: next });
    applyTheme(next);
    const label = { system: "themeSystem", dark: "themeDark", light: "themeLight" }[next];
    setStatus(`${t(L, "theme")}: ${t(L, label)}`);
  });
}

async function deepClearPopup() {
  if (!isWeb(tab?.url)) return;
  if (!confirm(t(L, "deepConfirm"))) return;
  const btn = $("deepBtn");
  btn.disabled = true;
  btn.classList.add("spin");
  await deepClear(tab);
  await reloadTab(tab.id);
  btn.classList.remove("spin");
  btn.disabled = false;
  setStatus(t(L, "deepDone"));
  await loadCookies();
}

document.addEventListener("DOMContentLoaded", init);
