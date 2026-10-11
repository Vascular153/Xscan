import asyncio
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


app = FastAPI(title="Xscan API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST"],
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
