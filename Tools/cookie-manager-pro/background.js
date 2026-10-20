importScripts("common.js", "i18n.js");

const MENU_ID = "clear-site";

async function buildMenu() {
  const { language } = await getSettings();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: t(language, "ctxClear"), contexts: ["page"] });
  });
}

async function clearSite(tab) {
  if (!tab?.url || !/^https?:/.test(tab.url)) return;
  await deepClear(tab);
  await reloadTab(tab.id);
}

function isWhitelisted(host, s) { return s.whitelist.some((d) => domainMatches(host, d)); }
function isBlacklisted(host, s) { return s.blacklist.some((d) => domainMatches(host, d)); }

async function clearAllExceptWhitelist(s) {
  const all = await chrome.cookies.getAll({});
  return removeCookies(all.filter((c) => !isWhitelisted(c.domain.replace(/^\./, ""), s)));
}

chrome.runtime.onInstalled.addListener(buildMenu);

chrome.runtime.onStartup.addListener(async () => {
  buildMenu();
  const s = await getSettings();
  if (s.autoStartup) await clearAllExceptWhitelist(s);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings?.newValue?.language !== changes.settings?.oldValue?.language) buildMenu();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID) clearSite(tab);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "clear-site") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  clearSite(tab);
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  const url = info.url || (info.status === "loading" ? tab.url : null);
  if (!url || !/^https?:/.test(url)) return;
  const { tabUrls = {} } = await chrome.storage.session.get("tabUrls");
  tabUrls[tabId] = url;
  await chrome.storage.session.set({ tabUrls });
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { tabUrls = {} } = await chrome.storage.session.get("tabUrls");
  const url = tabUrls[tabId];
  delete tabUrls[tabId];
  await chrome.storage.session.set({ tabUrls });
  if (!url) return;

  const s = await getSettings();
  if (s.autoMode === "off") return;

  const host = hostOf(url);
  if (!host || isWhitelisted(host, s)) return;
  if (s.autoMode === "listOnly" && !isBlacklisted(host, s)) return;

  const tabs = await chrome.tabs.query({});
  if (tabs.some((t) => hostOf(t.url || "") === host)) return;

  await removeSiteData(siteHosts(host));
});
