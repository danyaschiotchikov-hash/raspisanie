"""Расписание Петрозаводской консерватории: сайт, изменения учебного отдела и уведомления.

    python app.py              — открыть расписание в браузере (http://localhost:8765)
    python app.py --refresh    — сначала заново скачать расписание с сайта
    python app.py admin add ivanova "Иванова А.А."   — сотрудник учебного отдела (панель: /admin.html)
    python app.py --host 0.0.0.0 --port 8765 --no-browser   — запуск на сервере (за HTTPS-прокси)

Сайт лежит в папке site/ — ту же папку GitHub Pages публикует в интернете.
Сервер дополнительно хранит изменения в расписании и рассылает уведомления (backend.py),
а на своём компьютере ещё и обновляет данные кнопкой «Обновить с сайта».
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
DATA_FILE = SITE / "data" / "schedule.json"
STALE_HOURS = 12
MAX_BODY = 512 * 1024

_lock = threading.Lock()
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("text/javascript", ".js")
API: backend.Backend | None = None


def refresh() -> dict:
    with _lock:
        return scraper.build(DATA_FILE.parent)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(SITE), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        if self.path.startswith("/api/"):
            # сайт на GitHub Pages обращается к серверу с другого адреса; входа по cookie нет — «*» безопасно
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, If-None-Match")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Expose-Headers", "ETag")
            self.send_header("Access-Control-Max-Age", "86400")
        super().end_headers()

    def _json(self, code: int, obj, headers: dict | None = None):
        raw = b"" if obj is None else json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        if obj is not None:
            self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _local(self) -> bool:
        """Запрос с этого же компьютера, а не из интернета через прокси."""
        try:
            loop = ipaddress.ip_address(self.client_address[0]).is_loopback
        except ValueError:
            loop = False
        return loop and not self.headers.get("X-Forwarded-For") and not self.headers.get("X-Real-IP")

    def _ip(self) -> str:
        ip = self.client_address[0]
        if ipaddress.ip_address(ip).is_loopback:  # за HTTPS-прокси (Caddy, nginx) настоящий адрес в заголовке
            ip = self.headers.get("X-Real-IP") or (self.headers.get("X-Forwarded-For") or ip).split(",")[-1].strip()
        return ip

    def _api(self, method: str):
        path = self.path.split("?", 1)[0]
        if path == "/api/status" and method == "GET":
            return self._json(200, {"local": self._local(), "api": True, "push": API.push_ready})
        if path == "/api/refresh" and method == "POST":
            if not self._local():
                return self._json(403, {"error": "Обновление доступно только на компьютере с сервером"})
            try:
                return self._json(200, refresh())
            except Exception as e:  # noqa: BLE001
                traceback.print_exc()
                return self._json(502, {"error": str(e)})
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            return self._json(413, {"error": "Слишком большой запрос"})
        body = self.rfile.read(n) if n else b""
        try:
            code, obj, headers = API.handle(method, path, self.headers, body, self._ip())
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            code, obj, headers = 500, {"error": f"Ошибка сервера: {e}"}, {}
        self._json(code, obj, headers)

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self._api("GET")
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            return self._api("POST")
        self._json(404, {"error": "not found"})

    def do_OPTIONS(self):
        self.send_response(204 if self.path.startswith("/api/") else 405)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, fmt, *args):
        if args and "/api/" in str(args[0]) and "/api/feed" not in str(args[0]):
            sys.stderr.write("  " + fmt % args + "\n")


def free_port(host: str, preferred: int) -> int:
    for port in [preferred, *range(preferred + 1, preferred + 20)]:
        with socket.socket() as s:
            try:
                s.bind((host, port))
                return port
            except OSError:
                continue
    return 0


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    if sys.argv[1:2] == ["admin"]:
        sys.exit(backend.admin_cli(sys.argv[2:]))

    ap = argparse.ArgumentParser(description="Расписание Петрозаводской консерватории")
    ap.add_argument("--host", default="127.0.0.1", help="адрес для входящих соединений (на сервере — 0.0.0.0)")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--refresh", action="store_true", help="заново скачать расписание с сайта")
    ap.add_argument("--no-browser", action="store_true", help="не открывать браузер")
    args = ap.parse_args()

    global API
    API = backend.Backend()
    if not backend.PUSH_LIB:
        print("Уведомления выключены: установите библиотеку — pip install -r requirements.txt")
    if not API.admins:
        print("Сотрудников учебного отдела пока нет. Добавьте: python app.py admin add <логин> \"Имя\"")

    stale = not DATA_FILE.exists() or (time.time() - DATA_FILE.stat().st_mtime) > STALE_HOURS * 3600
    if args.refresh or stale:
        try:
            refresh()
        except Exception as e:  # noqa: BLE001
            print(f"Не удалось обновить расписание с сайта: {e}")
            if not DATA_FILE.exists():
                sys.exit(1)
            print("Показываю ранее сохранённые данные.")

    port = free_port(args.host, args.port) if args.host in ("127.0.0.1", "localhost") else args.port
    server = ThreadingHTTPServer((args.host, port), Handler)
    url = f"http://localhost:{server.server_address[1]}/"
    print(f"\nРасписание открыто: {url}\nПанель учебного отдела: {url}admin.html\n(Ctrl+C — остановить)")
    if not args.no_browser:
        threading.Timer(0.5, webbrowser.open, [url]).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
