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

function blockFileOpen(event) {
  if (event.dataTransfer.types.includes("Files")) {
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
    startAnalysis(selectedFile.name);
  }
});

function isGithubUrl(url) {
  const parts = url.split("/");
  return url.startsWith("https://github.com/") && parts.length >= 5 && parts[3] && parts[4];
}

githubInput.addEventListener("input", function () {
  if (isGithubUrl(githubInput.value.trim())) {
    linkForm.classList.add("ready");
  } else {
    linkForm.classList.remove("ready");
  }
  linkMessage.textContent = "";
});

githubInput.addEventListener("keydown", function (event) {
  if (event.key === "Enter") {
    githubBtn.click();
  }
});

githubBtn.addEventListener("click", function () {
  const url = githubInput.value.trim();
  if (!isGithubUrl(url)) {
    linkMessage.textContent = "Нужна ссылка вида https://github.com/владелец/репозиторий";
    return;
  }
  const parts = url.split("/");
  startAnalysis(parts[3] + "/" + parts[4]);
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

function startAnalysis(name) {
  if (document.body.classList.contains("scanning")) {
    return;
  }
  scanView.classList.remove("hidden");
  againBtn.classList.add("hidden");
  reportBtn.classList.add("hidden");
  document.body.classList.add("scanning");
  scanFile.textContent = name;
  scanStatus.textContent = "Идёт проверка";

  let percent = 0;
  showProgress(percent);
  const timer = setInterval(function () {
    percent = percent + 1;
    showProgress(percent);
    if (percent === 100) {
      clearInterval(timer);
      scanStatus.textContent = "Проверка завершена";
      againBtn.classList.remove("hidden");
      reportBtn.classList.remove("hidden");
    }
  }, 60);
}

againBtn.addEventListener("click", function () {
  scanView.classList.add("hidden");
  document.body.classList.remove("scanning");
  clearFile();
  githubInput.value = "";
  linkForm.classList.remove("ready");
  linkMessage.textContent = "";
});