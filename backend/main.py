import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


def load_env() -> None:
    path = Path(__file__).parent / ".env"
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            name, value = line.split("=", 1)
            os.environ.setdefault(name.strip(), value.strip().strip("\"'"))


load_env()

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-3.5-flash-lite"
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"

SEMGREP_BIN = str(Path(sys.executable).parent / "semgrep")
SEMGREP_CONFIGS = [
    "p/default",
    "p/security-audit",
    "p/secrets",
    "p/php",
    "p/python",
    "p/javascript",
    "p/java",
    "p/csharp",
    "p/golang",
    "p/c",
    "p/rust",
]
SEMGREP_TIMEOUT = 180

ALLOWED_EXT = {"py", "js", "java", "c", "h", "cpp", "hpp", "cs", "go", "php", "rs", "zip"}
MAX_FILE_BYTES = 1 * 1024 * 1024
MAX_ZIP_BYTES = 20 * 1024 * 1024
MAX_UNPACKED_BYTES = 100 * 1024 * 1024
MAX_UNPACKED_FILES = 5000
MAX_REPO_BYTES = 50 * 1024 * 1024
MAX_ISSUES_FOR_GEMINI = 40
SNIPPET_RADIUS = 3
SECOND_PASS_BUDGET = 120000
SECOND_PASS_FILE_LIMIT = 30000
MAX_SECOND_PASS_ISSUES = 30
SKIPPED_DIRS = {".git", "node_modules", "vendor", "venv", ".venv", "dist", "build", "__pycache__", "external"}
CODE_EXT = {"py", "js", "java", "c", "h", "cpp", "hpp", "cs", "go", "php", "rs"}
JOB_TTL = 3600
SCAN_TIME_LIMIT = 300

SEVERITY_MAP = {"ERROR": "error", "WARNING": "warning", "INFO": "info"}
SEVERITY_ORDER = {"error": 0, "warning": 1, "info": 2}


app = FastAPI(title="Xscan API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class GithubRequest(BaseModel):
    url: str


def parse_repository(url: str) -> tuple[str, str] | None:
    parsed = urlparse(url.strip())
    parts = [part for part in parsed.path.split("/") if part]
    if parsed.scheme != "https" or parsed.netloc.lower() != "github.com" or len(parts) != 2:
        return None
    return parts[0], parts[1].removesuffix(".git")


def repository_exists(owner: str, repository: str) -> bool:
    request = Request(
        f"https://api.github.com/repos/{owner}/{repository}",
        headers={"Accept": "application/vnd.github+json", "User-Agent": "Xscan"},
    )
    try:
        with urlopen(request, timeout=7) as response:
            return response.status == 200
    except HTTPError as error:
        if error.code == 404:
            return False
        raise


def download_repository(owner: str, repository: str, target: Path) -> None:
    request = Request(
        f"https://codeload.github.com/{owner}/{repository}/zip/HEAD",
        headers={"User-Agent": "Xscan"},
    )
    received = 0
    try:
        with urlopen(request, timeout=30) as response, open(target, "wb") as output:
            while True:
                chunk = response.read(64 * 1024)
                if not chunk:
                    break
                received += len(chunk)
                if received > MAX_REPO_BYTES:
                    raise HTTPException(status_code=413, detail="Репозиторий слишком большой для проверки")
                output.write(chunk)
    except HTTPError as error:
        if error.code == 404:
            raise HTTPException(status_code=404, detail="Репозиторий не найден или он не публичный")
        raise HTTPException(status_code=502, detail="Не удалось скачать репозиторий с GitHub")
    except (URLError, TimeoutError):
        raise HTTPException(status_code=502, detail="GitHub временно недоступен")


def unpack_archive(archive: Path, destination: Path) -> None:
    try:
        with zipfile.ZipFile(archive) as bundle:
            members = bundle.infolist()
            if len(members) > MAX_UNPACKED_FILES:
                raise HTTPException(status_code=413, detail="В архиве слишком много файлов")
            if sum(item.file_size for item in members) > MAX_UNPACKED_BYTES:
                raise HTTPException(status_code=413, detail="Архив слишком большой после распаковки")
            root = destination.resolve()
            for item in members:
                path = (destination / item.filename).resolve()
                if root != path and root not in path.parents:
                    raise HTTPException(status_code=400, detail="Архив содержит недопустимые пути")
            bundle.extractall(destination)
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Не удалось прочитать архив")


def find_scan_root(directory: Path) -> Path:
    entries = [entry for entry in directory.iterdir() if entry.name != "__MACOSX"]
    if len(entries) == 1 and entries[0].is_dir():
        return entries[0]
    return directory


def run_semgrep(root: Path) -> list[dict]:
    command = [SEMGREP_BIN, "scan", "--json", "--quiet", "--metrics=off", "--disable-version-check", "--timeout", "20"]
    for config in SEMGREP_CONFIGS:
        command += ["--config", config]
    command.append(str(root))
    try:
        completed = subprocess.run(command, capture_output=True, text=True, timeout=SEMGREP_TIMEOUT)
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Проверка заняла слишком много времени")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="Semgrep не установлен на сервере")
    if not completed.stdout.strip():
        raise HTTPException(status_code=500, detail="Semgrep завершился с ошибкой")
    try:
        data = json.loads(completed.stdout)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Semgrep вернул непонятный ответ")
    return data.get("results", [])


def read_lines(path: Path) -> list[str]:
    try:
        return path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []


def build_issues(root: Path, results: list[dict]) -> list[dict]:
    cache: dict[str, list[str]] = {}
    issues = []
    seen = set()
    for index, item in enumerate(results):
        key = (item.get("check_id"), item.get("path"), item.get("start", {}).get("line"))
        if key in seen:
            continue
        seen.add(key)
        file_path = Path(item.get("path", ""))
        relative = str(file_path.relative_to(root)) if file_path.is_absolute() and root in file_path.parents else str(file_path)
        if relative not in cache:
            cache[relative] = read_lines(root / relative)
        lines = cache[relative]
        start = item.get("start", {}).get("line", 1)
        end = item.get("end", {}).get("line", start)
        code = "\n".join(lines[start - 1:end]).strip() if lines else ""
        around_from = max(0, start - 1 - SNIPPET_RADIUS)
        around = "\n".join(lines[around_from:end + SNIPPET_RADIUS]) if lines else ""
        extra = item.get("extra", {})
        rule = item.get("check_id", "")
        issues.append({
            "id": index,
            "rule": rule,
            "title": rule.split(".")[-1].replace("-", " ").replace("_", " ").capitalize() or "Уязвимость",
            "severity": SEVERITY_MAP.get(str(extra.get("severity", "")).upper(), "warning"),
            "file": relative,
            "line": start,
            "message": str(extra.get("message", "")).strip(),
            "code": code[:500],
            "context": around[:1500],
        })
    issues.sort(key=lambda issue: (SEVERITY_ORDER[issue["severity"]], issue["file"], issue["line"]))
    return merge_duplicates(issues)


def merge_duplicates(issues: list[dict]) -> list[dict]:
    best: dict[tuple, dict] = {}
    for issue in issues:
        key = (issue["file"], issue["line"])
        if key not in best:
            best[key] = issue
    return list(best.values())


def call_gemini(prompt: str, timeout: int = 90, temperature: float = 0.1):
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": temperature},
    }).encode("utf-8")
    request = Request(
        GEMINI_URL,
        data=body,
        headers={"Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY},
        method="POST",
    )
    for attempt in range(4):
        try:
            with urlopen(request, timeout=timeout) as response:
                data = json.loads(response.read().decode("utf-8"))
            break
        except HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == 3:
                raise
            time.sleep(2 * (attempt + 1))
    return json.loads(data["candidates"][0]["content"]["parts"][0]["text"])


def ask_gemini(issues: list[dict]) -> list[dict]:
    payload_issues = [
        {
            "id": issue["id"],
            "rule": issue["rule"],
            "severity": issue["severity"],
            "file": issue["file"],
            "line": issue["line"],
            "semgrep_message": issue["message"],
            "code": issue["context"],
        }
        for issue in issues
    ]
    prompt = (
        "Ты эксперт по безопасности кода. Ниже результаты сканера Semgrep в формате JSON. "
        "Для каждой находки реши, настоящая ли это уязвимость или ложное срабатывание "
        "(тестовые данные, примеры, безопасное использование, мусорный шаблон). "
        "Оцени реальную опасность: error (высокая), warning (средняя), info (низкая). "
        "Для настоящих уязвимостей дай короткий заголовок на русском (до 8 слов) и понятное объяснение "
        "на русском в одном-двух предложениях с советом, как исправить. "
        "Верни только JSON-массив объектов вида "
        '{"id": число, "false_positive": true или false, "severity": "error|warning|info", '
        '"title": "строка", "message": "строка"} по одному объекту на каждую находку.\n\n'
        + json.dumps(payload_issues, ensure_ascii=False)
    )
    verdicts = call_gemini(prompt)
    if not isinstance(verdicts, list):
        raise ValueError("unexpected answer")
    return verdicts


def apply_verdicts(issues: list[dict], verdicts: list[dict]) -> list[dict]:
    by_id = {verdict.get("id"): verdict for verdict in verdicts if isinstance(verdict, dict)}
    kept = []
    for issue in issues:
        verdict = by_id.get(issue["id"])
        if verdict is None:
            kept.append(issue)
            continue
        if verdict.get("false_positive") is True:
            continue
        severity = str(verdict.get("severity", "")).lower()
        if severity in SEVERITY_ORDER:
            issue["severity"] = severity
        if verdict.get("title"):
            issue["title"] = str(verdict["title"]).strip()
        if verdict.get("message"):
            issue["message"] = str(verdict["message"]).strip()
        kept.append(issue)
    return kept


def finalize(issues: list[dict]) -> list[dict]:
    issues.sort(key=lambda issue: (SEVERITY_ORDER[issue["severity"]], issue["file"], issue["line"]))
    return [
        {
            "rule": issue["rule"],
            "title": issue["title"],
            "severity": issue["severity"],
            "file": issue["file"],
            "line": issue["line"],
            "message": issue["message"],
            "code": issue["code"],
        }
        for issue in issues
    ]


def collect_sources(root: Path) -> tuple[dict[str, list[str]], int]:
    candidates = []
    total = 0
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lstrip(".").lower() not in CODE_EXT:
            continue
        relative = path.relative_to(root)
        if any(part in SKIPPED_DIRS for part in relative.parts) or path.name.endswith(".min.js"):
            continue
        total += 1
        try:
            size = path.stat().st_size
        except OSError:
            continue
        if 0 < size <= SECOND_PASS_FILE_LIMIT:
            candidates.append((size, str(relative), path))
    candidates.sort()
    sources = {}
    used = 0
    for size, relative, path in candidates:
        if used + size > SECOND_PASS_BUDGET:
            break
        lines = read_lines(path)
        if lines:
            sources[relative] = lines
            used += size
    return sources, total


def second_pass(root: Path, existing: list[dict]) -> tuple[list[dict], int, int]:
    sources, total = collect_sources(root)
    if not sources:
        return [], 0, total
    listing = "\n\n".join(
        f"=== FILE: {name}\n" + "\n".join(f"{number}: {line}" for number, line in enumerate(lines, 1))
        for name, lines in sources.items()
    )
    prompt = (
        "Ты эксперт по безопасности кода. Ниже исходные файлы с номерами строк. "
        "Просмотри каждую строку каждого файла и перечисли все уязвимости, которые видны прямо в коде: инъекции (SQL, команд ОС, кода), "
        "небезопасное выполнение eval и exec, небезопасная десериализация, слабая криптография, "
        "пароли, токены и ключи, зашитые в код, раскрытие чувствительных данных, небезопасная работа с файлами и путями. "
        "Для каждой находки укажи файл ровно так, как он записан после FILE, номер строки, опасность "
        "(error: высокая, warning: средняя, info: низкая), короткий заголовок на русском (до 8 слов) "
        "и объяснение на русском в одном-двух предложениях с советом по исправлению. "
        'Верни только JSON-массив объектов вида {"file": "строка", "line": число, "severity": "error|warning|info", '
        '"title": "строка", "message": "строка"}.\n\n'
        + listing
    )
    try:
        found = call_gemini(prompt, timeout=120, temperature=0)
    except (HTTPError, URLError, TimeoutError, KeyError, IndexError, ValueError, json.JSONDecodeError):
        return [], len(sources), total
    if not isinstance(found, list):
        return [], len(sources), total
    taken = {(issue["file"], issue["line"]) for issue in existing}
    added = []
    for item in found:
        if not isinstance(item, dict):
            continue
        name = item.get("file")
        line = item.get("line")
        severity = str(item.get("severity", "")).lower()
        if name not in sources or not isinstance(line, int) or severity not in SEVERITY_ORDER:
            continue
        if not 1 <= line <= len(sources[name]) or (name, line) in taken:
            continue
        taken.add((name, line))
        added.append({
            "rule": "gemini.code-review",
            "title": str(item.get("title") or "Потенциальная уязвимость").strip(),
            "severity": severity,
            "file": name,
            "line": line,
            "message": str(item.get("message") or "").strip(),
            "code": sources[name][line - 1].strip()[:500],
        })
        if len(added) >= MAX_SECOND_PASS_ISSUES:
            break
    return added, len(sources), total


def scan_directory(root: Path, progress) -> tuple[list[dict], bool, list[str]]:
    progress(2)
    results = run_semgrep(root)
    issues = build_issues(root, results)
    progress(3)
    notes = []
    analyzed = True
    limited = issues[:MAX_ISSUES_FOR_GEMINI]
    rest = issues[MAX_ISSUES_FOR_GEMINI:]
    if limited:
        try:
            limited = apply_verdicts(limited, ask_gemini(limited))
        except (HTTPError, URLError, TimeoutError, KeyError, IndexError, ValueError, json.JSONDecodeError):
            analyzed = False
    if rest:
        notes.append(
            f"Gemini разобрал первые {MAX_ISSUES_FOR_GEMINI} находок из {len(issues)}, остальные показаны по данным Semgrep."
        )
    if not analyzed:
        notes.append("Gemini не ответил, поэтому отчёт построен только по данным Semgrep.")
    confirmed = finalize(limited + rest)
    progress(3)
    extra, viewed, total = second_pass(root, confirmed)
    if total > viewed:
        notes.append(
            f"Дополнительный просмотр Gemini охватил {viewed} из {total} файлов с кодом: слишком большие файлы и сверх лимита объёма пропущены."
        )
    progress(4)
    return finalize_all(confirmed + extra), analyzed, notes


def finalize_all(issues: list[dict]) -> list[dict]:
    issues.sort(key=lambda issue: (SEVERITY_ORDER[issue["severity"]], issue["file"], issue["line"]))
    return issues


def make_report(target: str, issues: list[dict], analyzed: bool, notes: list[str]) -> dict:
    return {
        "target": target,
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "status": "completed",
        "aiReview": analyzed,
        "notes": notes,
        "issues": issues,
    }


def scan_github_job(progress, owner: str, repository: str) -> dict:
    workdir = Path(tempfile.mkdtemp(prefix="xscan-"))
    try:
        progress(1)
        archive = workdir / "repo.zip"
        download_repository(owner, repository, archive)
        source = workdir / "source"
        source.mkdir()
        unpack_archive(archive, source)
        archive.unlink()
        issues, analyzed, notes = scan_directory(find_scan_root(source), progress)
        return make_report(f"{owner}/{repository}", issues, analyzed, notes)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def scan_upload_job(progress, name: str, content: bytes) -> dict:
    workdir = Path(tempfile.mkdtemp(prefix="xscan-"))
    try:
        progress(1)
        source = workdir / "source"
        source.mkdir()
        if name.lower().endswith(".zip"):
            archive = workdir / "upload.zip"
            archive.write_bytes(content)
            unpack_archive(archive, source)
            archive.unlink()
            root = find_scan_root(source)
        else:
            (source / name).write_bytes(content)
            root = source
        issues, analyzed, notes = scan_directory(root, progress)
        return make_report(name, issues, analyzed, notes)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()


def run_job(job_id: str, function, *args) -> None:
    started = time.time()

    def progress(stage: int) -> None:
        if time.time() - started > SCAN_TIME_LIMIT:
            raise HTTPException(
                status_code=504,
                detail="Проверка заняла слишком много времени. Загрузи проект поменьше или отдельные файлы.",
            )
        with JOBS_LOCK:
            JOBS[job_id]["stage"] = stage

    try:
        report = function(progress, *args)
        outcome = {"status": "done", "report": report}
    except HTTPException as error:
        outcome = {"status": "error", "error": str(error.detail)}
    except Exception:
        outcome = {"status": "error", "error": "Внутренняя ошибка сервера"}
    with JOBS_LOCK:
        JOBS[job_id].update(outcome)


def start_job(function, *args) -> dict:
    job_id = uuid.uuid4().hex
    now = time.time()
    with JOBS_LOCK:
        for key in [key for key, job in JOBS.items() if now - job["created"] > JOB_TTL]:
            del JOBS[key]
        JOBS[job_id] = {"status": "running", "stage": 1, "created": now}
    threading.Thread(target=run_job, args=(job_id, function, *args), daemon=True).start()
    return {"jobId": job_id}


@app.post("/api/github/check")
async def check_github(data: GithubRequest):
    repository = parse_repository(data.url)
    if not repository:
        raise HTTPException(status_code=422, detail="Некорректная ссылка на GitHub")
    try:
        exists = await asyncio.to_thread(repository_exists, *repository)
    except (HTTPError, URLError, TimeoutError):
        raise HTTPException(status_code=502, detail="GitHub временно недоступен")
    return {
        "exists": exists,
        "message": "Репозиторий найден" if exists else "Репозиторий не найден",
    }


@app.post("/api/scan/github")
async def scan_github(data: GithubRequest):
    repository = parse_repository(data.url)
    if not repository:
        raise HTTPException(status_code=422, detail="Некорректная ссылка на GitHub")
    return start_job(scan_github_job, *repository)


@app.post("/api/scan/file")
async def scan_file(file: UploadFile = File(...)):
    name = Path(file.filename or "").name
    extension = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if extension not in ALLOWED_EXT:
        raise HTTPException(status_code=422, detail="Такой тип файла не подходит")
    limit = MAX_ZIP_BYTES if extension == "zip" else MAX_FILE_BYTES
    content = await file.read(limit + 1)
    if len(content) > limit:
        raise HTTPException(status_code=413, detail="Файл слишком большой")
    if not content:
        raise HTTPException(status_code=422, detail="Файл пустой")
    return start_job(scan_upload_job, name, content)


@app.get("/api/scan/status/{job_id}")
async def scan_status(job_id: str):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Проверка не найдена")
        return {key: value for key, value in job.items() if key != "created"}
