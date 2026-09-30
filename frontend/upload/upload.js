const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const pickBtn = document.getElementById("pickBtn");
const dropText = document.getElementById("dropText");
const fileRow = document.getElementById("fileRow");
const fileName = document.getElementById("fileName");
const fileSize = document.getElementById("fileSize");
const removeBtn = document.getElementById("removeBtn");

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

function takeFile(file) {
  selectedFile = file;
  fileName.textContent = file.name;
  fileSize.textContent = (file.size / 1024).toFixed(1) + " КБ";
  dropText.classList.add("hidden");
  fileRow.classList.remove("hidden");

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
}

removeBtn.addEventListener("click", clearFile);