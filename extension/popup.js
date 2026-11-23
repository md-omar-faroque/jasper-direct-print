const enabledInput = document.getElementById("enabled");
const status = document.getElementById("status");

async function init() {
  const stored = await chrome.storage.sync.get(null);
  const enabled = stored.enabled !== undefined ? stored.enabled : true;
  const rules = Array.isArray(stored.rules) ? stored.rules : [];

  enabledInput.checked = enabled;

  const activeRules = rules.filter((rule) => rule && rule.enabled !== false);

  if (activeRules.length === 0) {
    status.textContent = "No rules configured yet";
  } else if (activeRules.length === 1) {
    status.textContent = `1 rule: ${activeRules[0].urlPattern || "(no pattern)"} \u2192 ${activeRules[0].printerName || "default printer"}`;
  } else {
    status.textContent = `${activeRules.length} active rules (${rules.length} total)`;
  }
}

enabledInput.addEventListener("change", async () => {
  await chrome.storage.sync.set({ enabled: enabledInput.checked });
  status.textContent = enabledInput.checked ? "Automatic printing enabled" : "Automatic printing disabled";
});

document.getElementById("openOptions").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

init();
