"""Локальный запуск расписания Петрозаводской консерватории.

    python app.py              — открыть расписание в браузере (http://localhost:8765)
    python app.py --refresh    — сначала заново скачать расписание с сайта

Сайт лежит в папке site/ — ту же папку GitHub Pages публикует в интернете.
Локальный сервер дополнительно умеет обновлять данные кнопкой «Обновить с сайта».
"""

from __future__ import annotations

import argparse
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

import scraper

ROOT = Path(__file__).resolve().parent
SITE = ROOT / "site"
DATA_FILE = SITE / "data" / "schedule.json"
STALE_HOURS = 12

_lock = threading.Lock()
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("text/javascript", ".js")


def refresh() -> dict:
    with _lock:
        return scraper.build(DATA_FILE.parent)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(SITE), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _json(self, code: int, obj):
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/api/status":
            return self._json(200, {"local": True})
        return super().do_GET()

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/api/refresh":
            return self._json(404, {"error": "not found"})
        try:
            self._json(200, refresh())
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            self._json(502, {"error": str(e)})

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
    ap = argparse.ArgumentParser(description="Расписание Петрозаводской консерватории")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--refresh", action="store_true", help="заново скачать расписание с сайта")
    ap.add_argument("--no-browser", action="store_true", help="не открывать браузер")
    args = ap.parse_args()

    stale = not DATA_FILE.exists() or (time.time() - DATA_FILE.stat().st_mtime) > STALE_HOURS * 3600
    if args.refresh or stale:
        try:
            refresh()
        except Exception as e:  # noqa: BLE001
            print(f"Не удалось обновить расписание с сайта: {e}")
            if not DATA_FILE.exists():
                sys.exit(1)
            print("Показываю ранее сохранённые данные.")

    port = free_port(args.port)
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://localhost:{server.server_address[1]}/"
    print(f"\nРасписание открыто: {url}\n(Ctrl+C — остановить)")
    if not args.no_browser:
        threading.Timer(0.5, webbrowser.open, [url]).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
