"""Расписание Петрозаводской консерватории на своём компьютере.

    python app.py              — открыть расписание в браузере (http://localhost:8765)
    python app.py --refresh    — сначала заново скачать расписание с сайта консерватории
    python app.py --admin      — сразу открыть панель учебного отдела (http://localhost:8765/admin/)
    python app.py github       — один раз настроить публикацию изменений на сайт

Сайт лежит в папке site/ — ту же папку GitHub Pages публикует в интернете.
Здесь дополнительно работают кнопка «Обновить с сайта» и панель учебного отдела:
изменения в расписании сохраняются файлом site/data/feed.json прямо на GitHub (backend.py),
поэтому отдельный сервер не нужен — программа запущена, только пока в панели работают.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import mimetypes
import socket
import sys
import threading
import time
import traceback
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import backend
import scraper

ROOT = Path(__file__).resolve().parent
SITE = ROOT / "site"
ADMIN = ROOT / "admin"
DATA_FILE = SITE / "data" / "schedule.json"
STALE_HOURS = 12
MAX_BODY = 512 * 1024
LOCAL_HOSTS = ("localhost", "127.0.0.1", "[::1]")

_lock = threading.Lock()
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("text/javascript", ".js")
STORE: backend.Store | None = None


def refresh() -> dict:
    with _lock:
        return scraper.build(DATA_FILE.parent)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(SITE), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def translate_path(self, path):
        # панель учебного отдела лежит отдельно от сайта, чтобы не попасть на GitHub Pages
        clean = path.split("?", 1)[0].split("#", 1)[0]
        if clean == "/admin" or clean.startswith("/admin/"):
            site, self.directory = self.directory, str(ADMIN)
            try:
                return super().translate_path(path[len("/admin"):] or "/")
            finally:
                self.directory = site
        return super().translate_path(path)

    def _json(self, code: int, obj):
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _local(self) -> bool:
        """Запрос с этого же компьютера и к localhost (а не чужой сайт через подмену DNS)."""
        try:
            loop = ipaddress.ip_address(self.client_address[0]).is_loopback
        except ValueError:
            loop = False
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].lower()
        return loop and host in LOCAL_HOSTS and not self.headers.get("X-Forwarded-For")

    def _api(self, method: str):
        path = self.path.split("?", 1)[0]
        if not self._local():
            return self._json(403, {"error": "Доступно только на этом компьютере"})
        # POST только из своих страниц: чужой сайт не может отправить такой заголовок без разрешения (CORS)
        if method == "POST" and self.headers.get("X-Rasp") != "1":
            return self._json(403, {"error": "Запрос не из панели"})
        if path == "/api/status" and method == "GET":
            return self._json(200, {"local": True, "admin": True})
        if path == "/api/refresh" and method == "POST":
            try:
                return self._json(200, refresh())
            except Exception as e:  # noqa: BLE001
                traceback.print_exc()
                return self._json(502, {"error": str(e)})
        if not path.startswith("/api/admin/"):
            return self._json(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            return self._json(413, {"error": "Слишком большой запрос"})
        body = self.rfile.read(n) if n else b""
        try:
            code, obj = STORE.handle(method, path[len("/api/admin/"):], body)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            code, obj = 500, {"error": f"Ошибка программы: {e}"}
        self._json(code, obj)

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self._api("GET")
        if self.path.startswith("/admin") and not self._local():
            return self._json(403, {"error": "Панель учебного отдела открывается только на этом компьютере"})
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            return self._api("POST")
        self._json(404, {"error": "not found"})

    def log_message(self, fmt, *args):
        if args and "/api/" in str(args[0]):
            sys.stderr.write("  " + fmt % args + "\n")


def free_port(preferred: int) -> int:
    for port in [preferred, *range(preferred + 1, preferred + 20)]:
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    return 0


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    if sys.argv[1:2] == ["github"]:
        sys.exit(backend.github_cli(sys.argv[2:]))

    ap = argparse.ArgumentParser(description="Расписание Петрозаводской консерватории")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--refresh", action="store_true", help="заново скачать расписание с сайта консерватории")
    ap.add_argument("--admin", action="store_true", help="открыть панель учебного отдела")
    ap.add_argument("--no-browser", action="store_true", help="не открывать браузер")
    args = ap.parse_args()

    global STORE
    STORE = backend.Store()
    if STORE.gh:
        STORE.sync()
        print(f"Публикация изменений: {STORE.gh.repo}" + (f"\n  ! {STORE.error}" if STORE.error else ""))
    else:
        print("Публикация изменений на сайт не настроена (изменения сохранятся только здесь). Настроить: python app.py github")

    stale = not DATA_FILE.exists() or (time.time() - DATA_FILE.stat().st_mtime) > STALE_HOURS * 3600
    if args.refresh or stale:
        try:
            refresh()
        except Exception as e:  # noqa: BLE001
            print(f"Не удалось обновить расписание с сайта: {e}")
            if not DATA_FILE.exists():
                sys.exit(1)
            print("Показываю ранее сохранённые данные.")

    server = ThreadingHTTPServer(("127.0.0.1", free_port(args.port)), Handler)
    url = f"http://localhost:{server.server_address[1]}/"
    print(f"\nРасписание: {url}\nПанель учебного отдела: {url}admin/\n(Ctrl+C или закрыть окно — остановить)")
    if not args.no_browser:
        threading.Timer(0.5, webbrowser.open, [url + ("admin/" if args.admin else "")]).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
