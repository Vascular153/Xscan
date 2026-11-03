const target = document.getElementById("target");
const issueCount = document.getElementById("issueCount");
const checkedAt = document.getElementById("checkedAt");
const resultText = document.getElementById("resultText");
const downloadBtn = document.getElementById("downloadBtn");
const issuesList = document.getElementById("issuesList");

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
  return {
    target: "api.py",
    checkedAt: new Date().toISOString(),
    status: "completed",
    issues: [
      {
        rule: "python.lang.security.audit.sqli",
        title: "Прямая SQL-инъекция",
        severity: "error",
        file: "api.py",
        line: 18,
        message: "Параметры запроса подставляются в SQL без экранирования.",
        code: "cursor.execute(f\"SELECT * FROM users WHERE id = '{user_id}'\")"
      },
      {
        rule: "generic.secrets.security.hardcoded-key",
        title: "Открытый секретный ключ",
        severity: "warning",
        file: "api.py",
        line: 6,
        message: "В коде найден жестко зашитый приватный токен.",
        code: "SECRET_KEY = \"AKIAIOSFODNN7EXAMPLE_SECRET_KEY\""
      },
      {
        rule: "python.lang.security.deserialization",
        title: "Небезопасная десериализация",
        severity: "info",
        file: "api.py",
        line: 32,
        message: "Использование небезопасного метода загрузки данных.",
        code: "data = pickle.loads(raw_stream)"
      }
    ]
  };
}

const report = getSavedReport();

target.textContent = report.target || "api.py";
const issues = report.issues || [];
issueCount.textContent = issues.length;
checkedAt.textContent = report.checkedAt
  ? new Date(report.checkedAt).toLocaleString("ru-RU")
  : new Date().toLocaleString("ru-RU");

if (issues.length > 0) {
  resultText.textContent = "Найдены потенциальные уязвимости в коде (" + issues.length + "):";
  issuesList.innerHTML = "";
  issues.forEach(function (issue) {
    const card = document.createElement("div");
    card.className = "issue-card";

    const header = document.createElement("div");
    header.className = "issue-header";

    const title = document.createElement("span");
    title.className = "issue-title";
    title.textContent = issue.title || issue.rule || "Обнаружена уязвимость";

    const badge = document.createElement("span");
    const sev = (issue.severity || "warning").toLowerCase();
    badge.className = "badge badge-" + sev;
    badge.textContent = sev === "error" ? "Высокая" : sev === "warning" ? "Средняя" : "Низкая";

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

    issuesList.appendChild(card);
  });
} else {
  resultText.textContent = "Уязвимости не найдены. Код успешно прошёл проверку.";
}

downloadBtn.addEventListener("click", function () {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = (report.target ? report.target.replace(/[/\\?%*:|"<>]/g, "_") : "xscan") + "-report.json";
  link.click();
  URL.revokeObjectURL(url);
});
