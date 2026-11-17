const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const pickBtn = document.getElementById("pickBtn");
const dropText = document.getElementById("dropText");
const fileRow = document.getElementById("fileRow");
const fileName = document.getElementById("fileName");
const fileSize = document.getElementById("fileSize");
const removeBtn = document.getElementById("removeBtn");
const submitBtn = document.getElementById("submitBtn");
const fileMessage = document.getElementById("fileMessage");
const linkForm = document.getElementById("linkForm");
const githubInput = document.getElementById("githubInput");
const githubBtn = document.getElementById("githubBtn");
const linkMessage = document.getElementById("linkMessage");
const scanView = document.getElementById("scanView");
const scanFile = document.getElementById("scanFile");
const scanPercent = document.getElementById("scanPercent");
const scanStatus = document.getElementById("scanStatus");
const progressArc = document.getElementById("progressArc");
const againBtn = document.getElementById("againBtn");
const reportBtn = document.getElementById("reportBtn");

const steps = document.querySelectorAll(".log li");
const allowedExt = ["py", "js", "java", "c", "h", "cpp", "hpp", "cs", "go", "php", "rs", "zip"];
const arcLength = 314.16;
let selectedFile = null;
let report = null;

function blockFileOpen(event) {
  if (event.dataTransfer && event.dataTransfer.types.includes("Files")) {
    event.preventDefault();
  }
}

window.addEventListener("dragover", blockFileOpen);
window.addEventListener("drop", blockFileOpen);

dropZone.addEventListener("click", function () {
  fileInput.click();
});

pickBtn.addEventListener("click", function () {
  fileInput.click();
});

fileInput.addEventListener("change", function () {
  if (fileInput.files.length > 0) {
    takeFile(fileInput.files[0]);
  }
});

dropZone.addEventListener("dragover", function (event) {
  event.preventDefault();
  dropZone.classList.add("drag-over");
  document.body.classList.add("drag");
});

dropZone.addEventListener("dragleave", function () {
  dropZone.classList.remove("drag-over");
  document.body.classList.remove("drag");
});

dropZone.addEventListener("drop", function (event) {
  event.preventDefault();
  dropZone.classList.remove("drag-over");
  document.body.classList.remove("drag");
  if (event.dataTransfer.files.length > 0) {
    takeFile(event.dataTransfer.files[0]);
  }
});

function checkFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (!allowedExt.includes(ext)) {
    return "Такой тип файла не подходит. Загрузи файл с кодом или архив .zip.";
  }
  const limit = ext === "zip" ? 20 : 1;
  if (file.size > limit * 1024 * 1024) {
    return "Файл больше " + limit + " МБ. Загрузи файл поменьше.";
  }
  return "";
}

function takeFile(file) {
  const error = checkFile(file);
  if (error !== "") {
    clearFile();
    fileMessage.textContent = error;
    return;
  }

  selectedFile = file;
  fileName.textContent = file.name;
  fileSize.textContent = (file.size / 1024).toFixed(1) + " КБ";
  dropText.classList.add("hidden");
  fileRow.classList.remove("hidden");
  fileMessage.textContent = "";

  dropZone.classList.add("ack");
  setTimeout(function () {
    dropZone.classList.remove("ack");
  }, 600);
}

function clearFile() {
  selectedFile = null;
  fileInput.value = "";
  fileRow.classList.add("hidden");
  dropText.classList.remove("hidden");
  fileMessage.textContent = "";
}

removeBtn.addEventListener("click", clearFile);

submitBtn.addEventListener("click", function () {
  if (selectedFile) {
    startAnalysis(selectedFile.name, scanFileRequest(selectedFile));
  }
});

function isGithubUrl(url) {
  try {
    const parsedUrl = new URL(url);
    const parts = parsedUrl.pathname.split("/").filter(Boolean);
    return parsedUrl.protocol === "https:" && parsedUrl.hostname === "github.com" && parts.length === 2;
  } catch {
    return false;
  }
}

githubInput.addEventListener("input", function () {
  if (isGithubUrl(githubInput.value.trim())) {
    linkForm.classList.add("ready");
  } else {
    linkForm.classList.remove("ready");
  }
  linkMessage.textContent = "";
  if (githubBtn.textContent === "Сканировать") {
    githubBtn.textContent = "Проверить";
  }
});

githubInput.addEventListener("keydown", function (event) {
  if (event.key === "Enter") {
    githubBtn.click();
  }
});

githubBtn.addEventListener("click", async function () {
  const url = githubInput.value.trim();
  if (!isGithubUrl(url)) {
    linkMessage.textContent = "Нужна ссылка вида https://github.com/владелец/репозиторий";
    linkMessage.classList.remove("success");
    return;
  }

  if (githubBtn.textContent === "Сканировать") {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    startAnalysis(parts.join("/"), scanGithubRequest(url));
    return;
  }

  githubBtn.disabled = true;
  githubBtn.textContent = "Проверяем";
  linkMessage.textContent = "";
  linkMessage.classList.remove("success");
  try {
    const response = await fetch(apiBase + "/api/github/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url })
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.detail || "Не удалось проверить репозиторий");
    }
    linkMessage.textContent = result.message;
    linkMessage.classList.toggle("success", result.exists);
    if (result.exists) {
      githubBtn.textContent = "Сканировать";
    }
  } catch (error) {
    linkMessage.textContent = error.message === "Failed to fetch"
      ? "Сервер проверки недоступен"
      : error.message;
  } finally {
    githubBtn.disabled = false;
    if (githubBtn.textContent !== "Сканировать") {
      githubBtn.textContent = "Проверить";
    }
  }
});

function showProgress(percent) {
  progressArc.style.strokeDashoffset = arcLength - (arcLength * percent) / 100;
  scanPercent.textContent = percent + "%";

  for (let i = 0; i < steps.length; i++) {
    if (percent >= (i + 1) * 25) {
      steps[i].className = "done";
    } else if (percent >= i * 25) {
      steps[i].className = "active";
    } else {
      steps[i].className = "";
    }
  }
}

const apiBase = "http://127.0.0.1:8000";
let creepTimer = null;
let pollTimer = null;
let currentStage = 1;
let currentPercent = 0;

function stopTimers() {
  clearInterval(creepTimer);
  clearTimeout(pollTimer);
  creepTimer = null;
  pollTimer = null;
}

function startCreep() {
  currentStage = 1;
  currentPercent = 0;
  showProgress(0);
  creepTimer = setInterval(function () {
    const floor = (currentStage - 1) * 25;
    const ceiling = currentStage * 25 - 2;
    currentPercent = Math.min(Math.max(currentPercent, floor) + 0.4, ceiling);
    showProgress(Math.floor(currentPercent));
  }, 250);
}

function showError(message) {
  scanStatus.textContent = message;
  scanStatus.classList.add("error");
  againBtn.classList.remove("hidden");
}

function finishScan(result) {
  stopTimers();
  showProgress(100);
  scanStatus.textContent = "Проверка завершена";
  report = result;
  sessionStorage.setItem("xscanReport", JSON.stringify(report));
  localStorage.setItem("xscanReport", JSON.stringify(report));
  againBtn.classList.remove("hidden");
  reportBtn.classList.remove("hidden");
}

function failScan(error) {
  stopTimers();
  showError(error.message === "Failed to fetch" ? "Сервер проверки недоступен" : error.message);
}

async function readJson(response) {
  const result = await response.json().catch(function () {
    return {};
  });
  if (!response.ok) {
    throw new Error(typeof result.detail === "string" ? result.detail : "Не удалось выполнить проверку");
  }
  return result;
}

async function pollJob(jobId) {
  try {
    const job = await readJson(await fetch(apiBase + "/api/scan/status/" + jobId));
    if (job.status === "done") {
      finishScan(job.report);
      return;
    }
    if (job.status === "error") {
      throw new Error(job.error || "Не удалось выполнить проверку");
    }
    if (job.stage > currentStage) {
      currentStage = job.stage;
      currentPercent = Math.max(currentPercent, (currentStage - 1) * 25);
    }
    pollTimer = setTimeout(function () {
      pollJob(jobId);
    }, 1000);
  } catch (error) {
    failScan(error);
  }
}

async function startAnalysis(name, request) {
  if (document.body.classList.contains("scanning")) {
    return;
  }
  scanView.classList.remove("hidden");
  againBtn.classList.add("hidden");
  reportBtn.classList.add("hidden");
  document.body.classList.add("scanning");
  scanFile.textContent = name;
  scanStatus.textContent = "Идёт проверка";
  scanStatus.classList.remove("error");
  report = null;
  startCreep();

  try {
    const started = await readJson(await request());
    pollJob(started.jobId);
  } catch (error) {
    failScan(error);
  }
}

function scanFileRequest(file) {
  const form = new FormData();
  form.append("file", file);
  return function () {
    return fetch(apiBase + "/api/scan/file", { method: "POST", body: form });
  };
}

function scanGithubRequest(url) {
  return function () {
    return fetch(apiBase + "/api/scan/github", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url })
    });
  };
}

againBtn.addEventListener("click", function () {
  scanView.classList.add("hidden");
  scanStatus.classList.remove("error");
  document.body.classList.remove("scanning");
  clearFile();
  githubInput.value = "";
  linkForm.classList.remove("ready");
  linkMessage.textContent = "";
  githubBtn.textContent = "Проверить";
});

reportBtn.addEventListener("click", function () {
  if (report) {
    const encoded = encodeURIComponent(JSON.stringify(report));
    window.location.href = "../report/report.html?data=" + encoded;
  } else {
    window.location.href = "../report/report.html";
  }
});
