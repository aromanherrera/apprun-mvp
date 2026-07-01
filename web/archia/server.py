#!/usr/bin/env python3
"""
Servidor local ArchIA
- Sirve ficheros estaticos en http://localhost:8080
- Proxea /api/* hacia la API real (elimina CORS)
Uso: python3 server.py
"""
import http.server, urllib.request, urllib.error, os, json, sys

API_BASE  = "https://api1-soarplus-pre.es.deloitte.com"
API_TOKEN = "sk-UmL4haDNvWZdQ4a8ZxKb3Q"
PORT      = 8080
SERVE_DIR = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=SERVE_DIR, **kw)

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/api/"):
            self._proxy("GET", b"")
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length) if length > 0 else b""
            self._proxy("POST", body)
        else:
            self.send_error(405)

    def _proxy(self, method, body):
        # /api/datasource/uploadfile/ -> https://...api.../datasource/uploadfile/
        target = API_BASE + self.path[4:]
        print(f"[PROXY] {method} {target}  body={len(body)}b")

        headers = {"Authorization": "Bearer " + API_TOKEN}
        ct = self.headers.get("Content-Type", "")
        if ct:
            headers["Content-Type"] = ct  # preserva boundary en multipart

        try:
            req = urllib.request.Request(
                target,
                data=body if body else None,
                headers=headers,
                method=method
            )
            with urllib.request.urlopen(req, timeout=120) as r:
                resp_body = r.read()
                resp_ct   = r.headers.get("Content-Type", "application/json")
                print(f"[PROXY] <- {r.status}  {len(resp_body)}b  {resp_ct}")
                self.send_response(r.status)
                self._cors_headers()
                self.send_header("Content-Type", resp_ct)
                self.send_header("Content-Length", str(len(resp_body)))
                self.end_headers()
                self.wfile.write(resp_body)

        except urllib.error.HTTPError as e:
            resp_body = e.read()
            print(f"[PROXY] <- HTTP {e.code}  {resp_body[:300]}")
            self.send_response(e.code)
            self._cors_headers()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(resp_body)))
            self.end_headers()
            self.wfile.write(resp_body)

        except Exception as e:
            msg = json.dumps({"error": str(e)}).encode()
            print(f"[PROXY] <- 502  {e}")
            self.send_response(502)
            self._cors_headers()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")

    def log_message(self, fmt, *args):
        if not self.path.startswith("/api/"):
            print(f"[STATIC] {fmt % args}")

if __name__ == "__main__":
    os.chdir(SERVE_DIR)
    print(f"\n  ArchIA local  →  http://localhost:{PORT}")
    print(f"  Proxy API     →  {API_BASE}\n")
    http.server.HTTPServer(("", PORT), Handler).serve_forever()
