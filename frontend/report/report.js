const target = document.getElementById("target");
const issueCount = document.getElementById("issueCount");
const checkedAt = document.getElementById("checkedAt");
const resultText = document.getElementById("resultText");
const downloadBtn = document.getElementById("downloadBtn");
const issuesList = document.getElementById("issuesList");
const toolbar = document.getElementById("toolbar");
const filters = document.getElementById("filters");
const sortSelect = document.getElementById("sortSelect");
const countError = document.getElementById("countError");
const countWarning = document.getElementById("countWarning");
const countInfo = document.getElementById("countInfo");
const notesList = document.getElementById("notes");

const severityOrder = { error: 0, warning: 1, info: 2 };
const severityNames = { error: "Высокая", warning: "Средняя", info: "Низкая" };
let currentFilter = "all";

function getSavedReport() {
  const params = new URLSearchParams(window.location.search);
  const dataParam = params.get("data");
  if (dataParam) {
    try {
      return JSON.parse(decodeURIComponent(dataParam));
    } catch (e) {}
  }
  const fromSession = sessionStorage.getItem("xscanReport");
  if (fromSession) {
    try {
      return JSON.parse(fromSession);
    } catch (e) {}
  }
  const fromLocal = localStorage.getItem("xscanReport");
  if (fromLocal) {
    try {
      return JSON.parse(fromLocal);
    } catch (e) {}
  }
  return { target: "", checkedAt: "", status: "empty", issues: [] };
}

const report = getSavedReport();
const issues = report.issues || [];

function severityOf(issue) {
  const value = (issue.severity || "warning").toLowerCase();
  return value in severityOrder ? value : "warning";
}

function createCard(issue) {
  const card = document.createElement("div");
  card.className = "issue-card";

  const header = document.createElement("div");
  header.className = "issue-header";

  const title = document.createElement("span");
  title.className = "issue-title";
  title.textContent = issue.title || issue.rule || "Обнаружена уязвимость";

  const severity = severityOf(issue);
  const badge = document.createElement("span");
  badge.className = "badge badge-" + severity;
  badge.textContent = severityNames[severity];

  header.appendChild(title);
  header.appendChild(badge);

  const loc = document.createElement("div");
  loc.className = "issue-location mono";
  loc.textContent = (issue.file || "unknown") + (issue.line ? ":" + issue.line : "");

  const desc = document.createElement("div");
  desc.className = "issue-desc";
  desc.textContent = issue.message || "";

  card.appendChild(header);
  card.appendChild(loc);
  card.appendChild(desc);

  if (issue.code) {
    const code = document.createElement("pre");
    code.className = "issue-code mono";
    code.textContent = issue.code;
    card.appendChild(code);
  }
  return card;
}

function renderIssues() {
  const visible = issues.filter(function (issue) {
    return currentFilter === "all" || severityOf(issue) === currentFilter;
  });

  visible.sort(function (a, b) {
    if (sortSelect.value === "file") {
      const byFile = String(a.file || "").localeCompare(String(b.file || ""));
      return byFile !== 0 ? byFile : (a.line || 0) - (b.line || 0);
    }
    const bySeverity = severityOrder[severityOf(a)] - severityOrder[severityOf(b)];
    return bySeverity !== 0 ? bySeverity : String(a.file || "").localeCompare(String(b.file || ""));
  });

  issuesList.innerHTML = "";
  if (visible.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Нет проблем с таким уровнем опасности.";
    issuesList.appendChild(empty);
    return;
  }
  visible.forEach(function (issue, index) {
    const card = createCard(issue);
    card.style.setProperty("--i", Math.min(index, 12));
    issuesList.appendChild(card);
  });
}

target.textContent = report.target || "Нет данных проверки";
function animateCount(element, value) {
  if (value === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    element.textContent = value;
    return;
  }
  const duration = 700;
  const started = performance.now();
  function step(now) {
    const progress = Math.min((now - started) / duration, 1);
    element.textContent = Math.round(value * progress);
    if (progress < 1) {
      requestAnimationFrame(step);
    }
  }
  requestAnimationFrame(step);
  setTimeout(function () {
    element.textContent = value;
  }, duration + 150);
}

function countBy(level) {
  return issues.filter(function (issue) {
    return severityOf(issue) === level;
  }).length;
}

checkedAt.textContent = report.checkedAt
  ? new Date(report.checkedAt).toLocaleString("ru-RU")
  : "—";

animateCount(issueCount, issues.length);
animateCount(countError, countBy("error"));
animateCount(countWarning, countBy("warning"));
animateCount(countInfo, countBy("info"));

(report.notes || []).forEach(function (note) {
  const item = document.createElement("li");
  item.textContent = note;
  notesList.appendChild(item);
});

if (issues.length > 0) {
  resultText.textContent = "Найдены потенциальные уязвимости в коде (" + issues.length + "):";
  toolbar.classList.remove("hidden");
  renderIssues();
} else if (report.status === "empty") {
  resultText.textContent = "Отчёта пока нет. Запусти новую проверку.";
} else {
  resultText.textContent = "Уязвимости не найдены. Код успешно прошёл проверку.";
}

filters.addEventListener("click", function (event) {
  const button = event.target.closest(".chip");
  if (!button) {
    return;
  }
  currentFilter = button.dataset.filter;
  filters.querySelectorAll(".chip").forEach(function (chip) {
    chip.classList.toggle("active", chip === button);
  });
  renderIssues();
});

sortSelect.addEventListener("change", renderIssues);

downloadBtn.addEventListener("click", function () {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = (report.target ? report.target.replace(/[/\\?%*:|"<>]/g, "_") : "xscan") + "-report.json";
  link.click();
  URL.revokeObjectURL(url);
});
