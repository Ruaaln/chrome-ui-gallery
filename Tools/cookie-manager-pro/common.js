const LANG_NAMES = {
  az: "Azərbaycanca", en: "English", tr: "Türkçe", ru: "Русский", de: "Deutsch",
  it: "Italiano", fr: "Français", es: "Español", pt: "Português", zh: "中文"
};
const LANG_CODES = Object.keys(LANG_NAMES);
const DEFAULTS = { theme: "system", autoMode: "off", autoStartup: false, whitelist: [], blacklist: [] };

function detectLang() {
  const c = (chrome.i18n?.getUILanguage?.() || "en").slice(0, 2).toLowerCase();
  return LANG_CODES.includes(c) ? c : "en";
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULTS, language: detectLang(), ...(settings || {}) };
}

async function saveSettings(patch) {
  const s = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: s });
  return s;
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

function domainMatches(host, domain) {
  const d = domain.replace(/^\./, "");
  return host === d || host.endsWith("." + d);
}

function cookieUrl(c) {
  const host = c.domain.replace(/^\./, "");
  return `${c.secure ? "https" : "http"}://${host}${c.path}`;
}

async function addStat(n) {
  const { stats = { removed: 0 } } = await chrome.storage.local.get("stats");
  stats.removed = (stats.removed || 0) + n;
  await chrome.storage.local.set({ stats });
}

async function removeCookies(list) {
  let n = 0;
  for (const c of list) {
    const r = await chrome.cookies.remove({ url: cookieUrl(c), name: c.name, storeId: c.storeId });
    if (r) n++;
  }
  if (n) await addStat(n);
  return n;
}

async function setCookieFromData(d) {
  const secure = !!d.secure;
  let sameSite = d.sameSite || "unspecified";
  if (sameSite === "no_restriction" && !secure) sameSite = "unspecified";
  const details = {
    url: `${secure ? "https" : "http"}://${d.domain.replace(/^\./, "")}${d.path || "/"}`,
    name: d.name,
    value: d.value ?? "",
    domain: d.domain,
    path: d.path || "/",
    secure,
    httpOnly: !!d.httpOnly,
    sameSite
  };
  if (!d.session && d.expirationDate) details.expirationDate = d.expirationDate;
  const res = await chrome.cookies.set(details);
  if (!res) throw new Error(chrome.runtime.lastError?.message || "set failed");
  return res;
}

function reloadTab(tabId) {
  return new Promise((resolve) => {
    const done = (id, info) => {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(done);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(done);
    chrome.tabs.reload(tabId);
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(done); resolve(); }, 15000);
  });
}

function applyI18n(lang) {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(lang, el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = t(lang, el.dataset.i18nPh); });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(lang, el.dataset.i18nTitle); });
}

function applyTheme(pref) {
  const dark = pref === "dark" || (pref !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

// ---------- Deep clear (all site data, not just cookies) ----------
const SITE_DATA_TYPES = {
  cookies: true,
  localStorage: true,
  indexedDB: true,
  cacheStorage: true,
  serviceWorkers: true,
  fileSystems: true,
  webSQL: true
};

// Host itself, its bare domain and its www variant (mirrors Chrome's "site data" list)
function siteHosts(host) {
  const bare = host.replace(/^www\./, "");
  return [...new Set([host, bare, "www." + bare])];
}

function originsFor(hosts) {
  return hosts.flatMap((h) => [`https://${h}`, `http://${h}`]);
}

// Hosts of iframes embedded in the tab (third-party "embedded sites" data)
async function frameHosts(tabId) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    return frames.map((f) => hostOf(f.url)).filter(Boolean);
  } catch {
    return [];
  }
}

function removeSiteData(hosts) {
  return chrome.browsingData.remove({ origins: originsFor(hosts), since: 0 }, SITE_DATA_TYPES);
}

async function deepClear(tab) {
  if (!tab?.url || !/^https?:/.test(tab.url)) return;
  const hosts = new Set(siteHosts(hostOf(tab.url)));
  for (const h of await frameHosts(tab.id)) hosts.add(h);
  await removeSiteData([...hosts]);
}
