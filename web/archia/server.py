#!/usr/bin/env python3
"""
Servidor local ArchIA
- Sirve los ficheros estaticos en http://localhost:8080
- Proxea /api/* hacia la API real (evita CORS)
Uso: python3 server.py
"""
import http.server
import urllib.request
import urllib.error
import os, json, sys

API_BASE  = "https://api1-soarplus-pre.es.deloitte.com"
API_TOKEN = "sk-UmL4haDNvWZdQ4a8ZxKb3Q"
PORT      = 8080
SERVE_DIR = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=SERVE_DIR, **kw)

    def do_OPTIONS(self):
        self._cors(); self.end_headers()

    def do_GET(self):
        if self.path.startswith("/api/"):
            self._proxy("GET", None)
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length) if length else None
            self._proxy("POST", body)
        else:
            self.send_error(405)

    def _proxy(self, method, body):
        target = API_BASE + self.path[4:]  # strip /api prefix
        headers = {
            "Authorization": "Bearer " + API_TOKEN,
        }
        ct = self.headers.get("Content-Type", "")
        if ct:
            headers["Content-Type"] = ct

        print(f"[PROXY] {method} {target}")
        try:
            req = urllib.request.Request(target, data=body, headers=headers, method=method)
            with urllib.request.urlopen(req, timeout=60) as r:
                resp_body = r.read()
                self._cors()
                self.send_response(r.status)
                for k, v in r.headers.items():
                    if k.lower() in ("content-type", "content-length"):
                        self.send_header(k, v)
                self.end_headers()
                self.wfile.write(resp_body)
                print(f"[PROXY] -> {r.status} ({len(resp_body)} bytes)")
        except urllib.error.HTTPError as e:
            body_err = e.read()
            print(f"[PROXY] -> HTTP {e.code}: {body_err[:200]}")
            self._cors()
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body_err)
        except Exception as e:
            print(f"[PROXY] -> ERROR: {e}")
            self._cors()
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def _cors(self):
        self.send_response(200) if self.command == "OPTIONS" else None
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")

    def log_message(self, fmt, *args):
        if not self.path.startswith("/api/"):
            print(f"[STATIC] {fmt % args}")

if __name__ == "__main__":
    os.chdir(SERVE_DIR)
    print(f"ArchIA local → http://localhost:{PORT}")
    print(f"Proxy API   → {API_BASE}")
    print("Ctrl+C para parar\n")
    http.server.HTTPServer(("", PORT), Handler).serve_forever()
