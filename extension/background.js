const NATIVE_HOST = "com.jasper.directprint";
const DEFAULT_URL_PATTERN = "jri/report";

// Legacy single-rule defaults (kept only for migrating old installs).
const legacyDefaults = {
  enabled: true,
  urlPattern: DEFAULT_URL_PATTERN,
  printerName: "",
  autoCloseTab: true,
  copies: 1,
  closeDelayMs: 0
};

// New multi-rule schema.
// rules: [{ id, enabled, urlPattern, printerName, copies, autoCloseTab, closeDelayMs }]
const defaultRule = () => ({
  id: `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  enabled: true,
  urlPattern: DEFAULT_URL_PATTERN,
  printerName: "",
  copies: 1,
  autoCloseTab: true,
  closeDelayMs: 0,
  printMode: "actual"
});

const defaultSettings = {
  enabled: true, // master on/off switch for the whole extension
  rules: []
};

function migrateLegacyToRules(stored) {
  // If we already have the new "rules" array, nothing to migrate.
  if (Array.isArray(stored.rules) && stored.rules.length > 0) {
    return null;
  }

  // If there's no legacy urlPattern/printerName at all, nothing to migrate either.
  if (!stored.urlPattern && !stored.printerName) {
    return null;
  }

  const migratedRule = {
    id: `rule-migrated-${Date.now()}`,
    enabled: true,
    urlPattern: stored.urlPattern || legacyDefaults.urlPattern,
    printerName: stored.printerName || "",
    copies: Number(stored.copies) || 1,
    autoCloseTab: stored.autoCloseTab !== undefined ? stored.autoCloseTab : true,
    closeDelayMs: Number(stored.closeDelayMs) || 0
  };

  return {
    enabled: stored.enabled !== undefined ? stored.enabled : true,
    rules: [migratedRule]
  };
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(null);

  const migrated = migrateLegacyToRules(stored);
  if (migrated) {
    await chrome.storage.sync.set(migrated);
    return migrated;
  }

  return {
    enabled: stored.enabled !== undefined ? stored.enabled : defaultSettings.enabled,
    rules: Array.isArray(stored.rules) ? stored.rules : []
  };
}

function urlMatchesPattern(url, pattern) {
  if (!url || !pattern) {
    return false;
  }

  try {
    const normalizedPattern = pattern.trim();
    if (!normalizedPattern) {
      return false;
    }

    if (normalizedPattern.startsWith("http://") || normalizedPattern.startsWith("https://")) {
      return url.startsWith(normalizedPattern);
    }

    return url.includes(normalizedPattern);
  } catch {
    return false;
  }
}

function isPdfReportUrl(url) {
  if (!url) {
    return false;
  }

  const lower = url.toLowerCase();
  return lower.includes("_repformat=pdf") || lower.endsWith(".pdf");
}

function sendNativeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

async function getCookieHeader(url) {
  const cookies = await chrome.cookies.getAll({ url });
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

const printingTabs = new Set();

async function sleep(ms) {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function closeTabReliably(tabId, maxAttempts = 12, intervalMs = 100) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await chrome.tabs.get(tabId);
      await chrome.tabs.remove(tabId);
      return true;
    } catch (error) {
      const message = String(error?.message || error);
      if (message.includes("No tab with id")) {
        return true;
      }

      if (attempt === maxAttempts - 1) {
        console.warn("[Jasper Direct Print] Could not close tab", tabId, error);
        return false;
      }

      await sleep(intervalMs);
    }
  }

  return false;
}

// Finds the first enabled rule whose urlPattern matches the given URL.
// Rule order in storage = priority order (first match wins).
function findMatchingRule(url, rules) {
  for (const rule of rules) {
    if (!rule || rule.enabled === false) {
      continue;
    }
    if (urlMatchesPattern(url, rule.urlPattern)) {
      return rule;
    }
  }
  return null;
}

async function getReportRule(url) {
  const settings = await getSettings();
  if (!settings.enabled) {
    return null;
  }

  if (!isPdfReportUrl(url)) {
    return null;
  }

  const rule = findMatchingRule(url, settings.rules);
  return rule;
}

async function printTabPdf(tabId, url, rule) {
  if (printingTabs.has(tabId)) {
    return;
  }

  printingTabs.add(tabId);

  let tabClosed = false;

  try {

    const cookieHeader = await getCookieHeader(url);

    if (rule.autoCloseTab) {
      await sleep(Math.max(0, Number(rule.closeDelayMs) || 0));
      tabClosed = await closeTabReliably(tabId);
    }

    const result = await sendNativeMessage({
      action: "printUrl",
      url,
      cookieHeader,
      printerName: rule.printerName || "",
      copies: Number(rule.copies) || 1,
      printMode: rule.printMode || "actual",
      fileName: `jasper-report-${Date.now()}.pdf`
    });

    if (!result || !result.success) {
      throw new Error(result?.error || "Native print host returned an error");
    }
  } catch (error) {
    console.error("[Jasper Direct Print]", error);
    chrome.notifications?.create?.({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Jasper Direct Print failed",
      message: error.message || String(error)
    });
  } finally {
    if (rule?.autoCloseTab && !tabClosed) {
      await closeTabReliably(tabId, 8, 150);
    }
    printingTabs.delete(tabId);
  }
}

async function handleReportTab(tabId, url) {
  if (!url || printingTabs.has(tabId)) {
    return;
  }

  const rule = await getReportRule(url);
  if (!rule) {
    return;
  }

  printTabPdf(tabId, url, rule);
}

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }

  handleReportTab(details.tabId, details.url);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") {
    return;
  }

  handleReportTab(tabId, tab.url);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action === "listPrinters") {
    sendNativeMessage({ action: "listPrinters" })
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message?.action === "testPrint") {
    sendNativeMessage({ action: "testConnection" })
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  return false;
});
