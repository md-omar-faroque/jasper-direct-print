const DEFAULT_URL_PATTERN = "jri/report";

const legacyDefaults = {
  enabled: true,
  urlPattern: DEFAULT_URL_PATTERN,
  printerName: "",
  autoCloseTab: true,
  copies: 1,
  closeDelayMs: 0
};

function makeRule(overrides = {}) {
  return {
    id: `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    enabled: true,
    urlPattern: "",
    printerName: "",
    copies: 1,
    autoCloseTab: true,
    closeDelayMs: 0,
    // "actual" (default) = print at 100%, no scaling - preserves barcode
    // integrity. "auto" = old fit-to-page scaling, only for reports whose
    // page size doesn't match the loaded paper. "exact-landscape" /
    // "exact-portrait" = actual size PLUS a forced orientation, for labels.
    printMode: "actual",
    ...overrides
  };
}

const elements = {
  enabled: document.getElementById("enabled"),
  rules: document.getElementById("rules"),
  addRule: document.getElementById("addRule"),
  save: document.getElementById("save"),
  refreshPrinters: document.getElementById("refreshPrinters"),
  testConnection: document.getElementById("testConnection"),
  status: document.getElementById("status"),

  loginScreen: document.getElementById("loginScreen"),
  authPrompt: document.getElementById("authPrompt"),
  loginUsername: document.getElementById("loginUsername"),
  loginPassword: document.getElementById("loginPassword"),
  confirmPasswordField: document.getElementById("confirmPasswordField"),
  loginConfirmPassword: document.getElementById("loginConfirmPassword"),
  loginSubmit: document.getElementById("loginSubmit"),
  authError: document.getElementById("authError"),

  settingsPanel: document.getElementById("settingsPanel"),
  lockNow: document.getElementById("lockNow")
};

let currentPrinters = [];
let currentRules = [];

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPassword(password, saltHex) {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${saltHex}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
}

function showScreen(screenToShow) {
  for (const screen of [elements.loginScreen, elements.settingsPanel]) {
    screen.classList.add("hidden");
  }
  screenToShow.classList.remove("hidden");
}

async function unlockSettings() {
  showScreen(elements.settingsPanel);
  await init();
}

async function attemptLogin() {
  const username = elements.loginUsername.value.trim();
  const password = elements.loginPassword.value;

  elements.authError.classList.remove("show");

  try {
    const stored = await chrome.storage.local.get("settingsAuth");
    if (!stored.settingsAuth) {
      if (!username) {
        throw new Error("Enter a username.");
      }
      if (password.length < 12) {
        throw new Error("Choose a password with at least 12 characters.");
      }
      if (password !== elements.loginConfirmPassword.value) {
        throw new Error("The passwords do not match.");
      }

      const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
      const hash = await hashPassword(password, salt);
      await chrome.storage.local.set({
        settingsAuth: { username, salt, hash }
      });
    } else {
      const auth = stored.settingsAuth;
      const hash = await hashPassword(password, auth.salt);
      if (
        username.toLowerCase() !== auth.username.toLowerCase() ||
        hash !== auth.hash
      ) {
        throw new Error("Incorrect username or password.");
      }
    }

    elements.loginUsername.value = "";
    elements.loginPassword.value = "";
    elements.loginConfirmPassword.value = "";
    await unlockSettings();
  } catch (error) {
    elements.authError.textContent = error instanceof Error
      ? error.message
      : "Unable to update local access settings.";
    elements.authError.classList.add("show");
    elements.loginPassword.value = "";
    elements.loginConfirmPassword.value = "";
  }
}

elements.loginSubmit.addEventListener("click", attemptLogin);
const submitOnEnter = (event) => {
  if (event.key === "Enter") {
    attemptLogin();
  }
};
elements.loginPassword.addEventListener("keydown", submitOnEnter);
elements.loginConfirmPassword.addEventListener("keydown", submitOnEnter);

elements.lockNow.addEventListener("click", () => {
  checkAuth();
});

async function checkAuth() {
  showScreen(elements.loginScreen);
  elements.authError.classList.remove("show");
  elements.authError.textContent = "";

  try {
    const stored = await chrome.storage.local.get("settingsAuth");
    const isFirstRun = !stored.settingsAuth;
    elements.authPrompt.textContent = isFirstRun
      ? "Create a local password to open settings. Use at least 12 characters."
      : "Enter your local username and password to open settings.";
    elements.confirmPasswordField.classList.toggle("hidden", !isFirstRun);
    elements.loginSubmit.textContent = isFirstRun ? "Create password" : "Unlock";
    elements.loginPassword.autocomplete = isFirstRun ? "new-password" : "current-password";
    elements.loginUsername.value = isFirstRun ? "" : stored.settingsAuth.username;
    elements.loginPassword.value = "";
    elements.loginConfirmPassword.value = "";
  } catch (error) {
    elements.authError.textContent = error instanceof Error
      ? error.message
      : "Unable to read local access settings.";
    elements.authError.classList.add("show");
  }
}

let statusHideTimer = null;

function showStatus(message, ok) {
  elements.status.textContent = message;
  elements.status.className = ok ? "ok" : "error";

  if (statusHideTimer) {
    clearTimeout(statusHideTimer);
    statusHideTimer = null;
  }

  if (ok) {
    statusHideTimer = setTimeout(() => {
      elements.status.className = "";
      elements.status.textContent = "";
    }, 1500);
  }
}

function migrateLegacyToRules(stored) {
  if (Array.isArray(stored.rules) && stored.rules.length > 0) {
    return null;
  }

  if (!stored.urlPattern && !stored.printerName) {
    return null;
  }

  const migratedRule = makeRule({
    id: `rule-migrated-${Date.now()}`,
    urlPattern: stored.urlPattern || legacyDefaults.urlPattern,
    printerName: stored.printerName || "",
    copies: Number(stored.copies) || 1,
    autoCloseTab: stored.autoCloseTab !== undefined ? stored.autoCloseTab : true,
    closeDelayMs: Number(stored.closeDelayMs) || 0
  });

  return {
    enabled: stored.enabled !== undefined ? stored.enabled : true,
    rules: [migratedRule]
  };
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get(null);

  const migrated = migrateLegacyToRules(stored);
  if (migrated) {
    await chrome.storage.sync.set(migrated);
    elements.enabled.checked = migrated.enabled;
    currentRules = migrated.rules;
    return migrated;
  }

  const settings = {
    enabled: stored.enabled !== undefined ? stored.enabled : true,
    rules: Array.isArray(stored.rules) ? stored.rules : []
  };

  elements.enabled.checked = settings.enabled;
  currentRules = settings.rules;
  return settings;
}

function printerOptionsHtml(selectedPrinter) {
  const options = [`<option value="">Use Windows default printer</option>`];
  for (const printer of currentPrinters) {
    const selected = printer === selectedPrinter ? "selected" : "";
    options.push(`<option value="${escapeHtml(printer)}" ${selected}>${escapeHtml(printer)}</option>`);
  }
  if (selectedPrinter && !currentPrinters.includes(selectedPrinter)) {
    options.push(`<option value="${escapeHtml(selectedPrinter)}" selected>${escapeHtml(selectedPrinter)} (not detected)</option>`);
  }
  return options.join("");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderRules() {
  elements.rules.innerHTML = "";

  if (currentRules.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No rules yet. Click \"Add rule\" to route a report URL to a printer.";
    elements.rules.appendChild(empty);
    return;
  }

  currentRules.forEach((rule, index) => {
    const card = document.createElement("div");
    card.className = "rule-card";
    card.dataset.index = String(index);

    card.innerHTML = `
      <div class="rule-header">
        <span class="badge">RULE ${index + 1}${index === 0 ? " (highest priority)" : ""}</span>
        <div class="actions" style="margin:0;">
          <button type="button" class="secondary small" data-action="moveUp" ${index === 0 ? "disabled" : ""}>&uarr; Up</button>
          <button type="button" class="secondary small" data-action="moveDown" ${index === currentRules.length - 1 ? "disabled" : ""}>&darr; Down</button>
          <button type="button" class="danger small" data-action="delete">Delete</button>
        </div>
      </div>

      <div class="rule-grid">
        <div class="field">
          <label>Report URL pattern</label>
          <input type="text" data-field="urlPattern" placeholder="e.g. reports.example.com/jri/report or _repName=SALES_REPORT" value="${escapeHtml(rule.urlPattern || "")}" />
        </div>
        <div class="field">
          <label>Printer</label>
          <select data-field="printerName">${printerOptionsHtml(rule.printerName)}</select>
        </div>
        <div class="field">
          <label>Copies</label>
          <input type="number" min="1" max="10" data-field="copies" value="${Number(rule.copies) || 1}" />
        </div>
        <div class="field">
          <label>Print mode</label>
          <select data-field="printMode">
            <option value="actual" ${(rule.printMode || "actual") === "actual" ? "selected" : ""}>Actual size (no scaling - protects barcodes)</option>
            <option value="exact-landscape" ${rule.printMode === "exact-landscape" ? "selected" : ""}>Actual size - force landscape</option>
            <option value="exact-portrait" ${rule.printMode === "exact-portrait" ? "selected" : ""}>Actual size - force portrait</option>
            <option value="auto" ${rule.printMode === "auto" ? "selected" : ""}>Fit to page (scales content)</option>
          </select>
        </div>
      </div>

      <div class="rule-footer">
        <div class="left">
          <div class="field">
            <input type="checkbox" data-field="enabled" ${rule.enabled !== false ? "checked" : ""} />
            <label>Rule enabled</label>
          </div>
          <div class="field">
            <input type="checkbox" data-field="autoCloseTab" ${rule.autoCloseTab !== false ? "checked" : ""} />
            <label>Close report tab automatically</label>
          </div>
          <div class="field">
            <label>Close delay (ms)</label>
            <input type="number" min="0" step="100" data-field="closeDelayMs" value="${Number(rule.closeDelayMs) || 0}" />
          </div>
        </div>
      </div>
    `;

    card.querySelectorAll("[data-field]").forEach((input) => {
      const field = input.dataset.field;
      const eventName = input.type === "checkbox" || input.tagName === "SELECT" ? "change" : "input";
      input.addEventListener(eventName, () => {
        const value = input.type === "checkbox" ? input.checked : input.value;
        currentRules[index] = { ...currentRules[index], [field]: value };
      });
    });

    card.querySelector('[data-action="delete"]').addEventListener("click", () => {
      currentRules.splice(index, 1);
      renderRules();
    });

    card.querySelector('[data-action="moveUp"]').addEventListener("click", () => {
      if (index === 0) return;
      [currentRules[index - 1], currentRules[index]] = [currentRules[index], currentRules[index - 1]];
      renderRules();
    });

    card.querySelector('[data-action="moveDown"]').addEventListener("click", () => {
      if (index === currentRules.length - 1) return;
      [currentRules[index + 1], currentRules[index]] = [currentRules[index], currentRules[index + 1]];
      renderRules();
    });

    elements.rules.appendChild(card);
  });
}

async function refreshPrinters() {
  const response = await chrome.runtime.sendMessage({ action: "listPrinters" });
  if (!response?.success) {
    currentPrinters = [];
    throw new Error(response?.error || "Could not load printers from native host");
  }
  currentPrinters = response.printers || [];
  renderRules();
}

async function init() {
  await loadSettings();
  renderRules();

  try {
    await refreshPrinters();
    showStatus("Settings loaded.", true);
  } catch (error) {
    showStatus(
      `${error.message}. Install the native print host from the project README, then click "Test native host".`,
      false
    );
  }
}

elements.addRule.addEventListener("click", () => {
  currentRules.push(makeRule({ urlPattern: DEFAULT_URL_PATTERN }));
  renderRules();
});

elements.save.addEventListener("click", async () => {
  const settings = {
    enabled: elements.enabled.checked,
    rules: currentRules.map((rule) => ({
      id: rule.id,
      enabled: rule.enabled !== false,
      urlPattern: (rule.urlPattern || "").trim(),
      printerName: rule.printerName || "",
      copies: Number(rule.copies) || 1,
      autoCloseTab: rule.autoCloseTab !== false,
      closeDelayMs: Number(rule.closeDelayMs) || 0,
      printMode: rule.printMode || "actual"
    }))
  };

  const emptyPattern = settings.rules.find((rule) => !rule.urlPattern);
  if (emptyPattern) {
    showStatus("Every rule needs a URL pattern before saving.", false);
    return;
  }

  // Clear legacy top-level keys so migration logic doesn't re-trigger.
  await chrome.storage.sync.remove(["urlPattern", "printerName", "copies", "autoCloseTab", "closeDelayMs"]);
  await chrome.storage.sync.set(settings);
  showStatus("Settings saved.", true);
});

elements.refreshPrinters.addEventListener("click", async () => {
  try {
    await refreshPrinters();
    showStatus("Printer list refreshed.", true);
  } catch (error) {
    showStatus(error.message, false);
  }
});

elements.testConnection.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ action: "testPrint" });
  if (response?.success) {
    showStatus(`Native host connected. SumatraPDF: ${response.sumatraPath || "not found"}`, true);
    return;
  }

  showStatus(response?.error || "Native host test failed", false);
});

checkAuth();
