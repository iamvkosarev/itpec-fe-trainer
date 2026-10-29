#!/usr/bin/env bash
# Serves the app locally. The question bank is loaded with fetch(), which
# browsers refuse over file://, so a real HTTP origin is required.
#
# Keep the port and host stable: saved progress lives in the browser's
# localStorage, which is scoped to the exact origin (http://localhost:8765 and
# http://localhost:8766 are separate stores, as are localhost and 127.0.0.1).
set -euo pipefail
cd "$(dirname "$0")/web"
PORT="${1:-8765}"
URL="http://localhost:${PORT}/"
# Words picked out of question texts are kept on disk, not in the browser, so
# they can be read and translated outside the app (see tools/vocab.py).
VOCAB_DIR="$(cd .. && pwd)/vocab"
echo "ITPEC FE trainer -> ${URL}"
command -v open >/dev/null && (sleep 1 && open "$URL") &
# A plain http.server lets the browser cache files heuristically for days, so
# an updated bank or script would not show up. "no-cache" makes it revalidate
# every time; unchanged files still come back as a cheap 304.
exec python3 - "$PORT" "$VOCAB_DIR" <<'PY'
import datetime
import http.server
import json
import os
import re
import sys
import threading
import unicodedata
from pathlib import Path

VOCAB = Path(sys.argv[2])
WORDS = VOCAB / "words.json"
TRANSLATIONS = VOCAB / "translations.json"
# Requests are served on threads; every read-modify-write of words.json holds it.
LOCK = threading.Lock()
EDGE = " \t\r\n.,;:!?()[]{}\"'«»…-–—/"


def clean(phrase):
    """("Critical path", "critical path"): the phrase as shown and its unique key."""
    text = unicodedata.normalize("NFKC", phrase).replace("’", "'").replace("‘", "'")
    text = re.sub(r"\s+", " ", text).strip(EDGE)
    return text, text.lower()


def load(path, fallback):
    try:
        return json.loads(path.read_text("utf-8"))
    except FileNotFoundError:
        return fallback


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", "utf-8")
    os.replace(tmp, path)


def add_word(store, data):
    """Adds a phrase once; meeting it in another question only adds an example."""
    phrase, key = clean(str(data.get("phrase", "")))
    if not key or len(phrase) > 120:
        return None, False
    qid = str(data.get("qid", ""))[:40]
    context = re.sub(r"\s+", " ", str(data.get("context", ""))).strip()[:400]
    created = False
    word = next((w for w in store["words"] if w["key"] == key), None)
    if word is None:
        created = True
        word = {"key": key, "phrase": phrase,
                "added": datetime.datetime.now().isoformat(timespec="seconds"), "contexts": []}
        store["words"].append(word)
    if qid and not any(c["qid"] == qid for c in word["contexts"]):
        word["contexts"].append({"qid": qid, "text": context})
    return word, created


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".webp": "image/webp", ".js": "text/javascript"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    # A running exam sends HEAD every 15 s to notice a stopped server and
    # pause its clock; logging those would bury everything else.
    def log_request(self, code="-", size="-"):
        if self.command != "HEAD":
            super().log_request(code, size)

    def send_json(self, status, body):
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path.split("?")[0] != "/api/vocab":
            return super().do_GET()
        with LOCK:
            words = load(WORDS, {"words": []})["words"]
            try:
                translations = load(TRANSLATIONS, {})
            except ValueError as err:
                # A hand-edited file with a typo must not hide the word list.
                self.log_error("vocab/translations.json is not valid JSON: %s", err)
                translations = {}
        self.send_json(200, {"words": words, "translations": translations})

    def do_POST(self):
        route = self.path.split("?")[0]
        if route not in ("/api/vocab/add", "/api/vocab/remove"):
            return self.send_json(404, {"error": "unknown endpoint"})
        # Only the app's own pages can send JSON here: another site can post
        # this content type only after a CORS preflight, which gets no answer.
        if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
            return self.send_json(415, {"error": "expected application/json"})
        length = int(self.headers.get("Content-Length") or 0)
        if length > 20000:
            return self.send_json(413, {"error": "too large"})
        try:
            data = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return self.send_json(400, {"error": "bad json"})
        with LOCK:
            store = load(WORDS, {"version": 1, "words": []})
            if route.endswith("/add"):
                word, created = add_word(store, data)
                if word is None:
                    return self.send_json(400, {"error": "empty or too long phrase"})
                save(WORDS, store)
                return self.send_json(200, {"word": word, "created": created})
            key = clean(str(data.get("key", "")))[1]
            before = len(store["words"])
            store["words"] = [w for w in store["words"] if w["key"] != key]
            if len(store["words"]) != before:
                save(WORDS, store)
            return self.send_json(200, {"removed": len(store["words"]) != before})


http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
PY
