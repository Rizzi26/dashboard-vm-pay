"""Stub mínimo do Supabase Auth: password grant, getUser, logout.

Suficiente para @supabase/ssr acreditar que está falando com o Supabase. O JWT
é HS256 com segredo compartilhado com o stub do backend.
"""
import json, time
from http.server import BaseHTTPRequestHandler, HTTPServer

import base64, hmac, hashlib

SECRET = b"segredo-de-teste-com-32-bytes-ok!!"
USERS = {
    "master@mercadinho.dev": {"id": "11111111-1111-1111-1111-111111111111", "senha": "senha-master", "role": "master"},
    "viewer@mercadinho.dev": {"id": "22222222-2222-2222-2222-222222222222", "senha": "senha-viewer", "role": "viewer"},
}

def b64(d): return base64.urlsafe_b64encode(d).rstrip(b"=")

def make_jwt(user):
    now = int(time.time())
    header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = b64(json.dumps({
        "sub": user["id"], "email": user["email"], "aud": "authenticated",
        "iat": now, "exp": now + 3600, "role": "authenticated",
    }).encode())
    signing = header + b"." + payload
    sig = b64(hmac.new(SECRET, signing, hashlib.sha256).digest())
    return (signing + b"." + sig).decode()

def user_json(u, email):
    return {"id": u["id"], "aud": "authenticated", "role": "authenticated",
            "email": email, "created_at": "2026-01-01T00:00:00Z",
            "app_metadata": {}, "user_metadata": {}}

class H(BaseHTTPRequestHandler):
    def _send(self, code, body=None):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "*")
        self.end_headers()
        if body is not None:
            self.wfile.write(json.dumps(body).encode())

    def do_OPTIONS(self):
        self._send(204)

    def do_POST(self):
        if self.path.startswith("/auth/v1/token"):
            length = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(length) or b"{}")
            email = data.get("email", "")
            u = USERS.get(email)
            if not u or data.get("password") != u["senha"]:
                self._send(400, {"error": "invalid_grant", "error_description": "Invalid login credentials"})
                return
            user = {**u, "email": email}
            token = make_jwt(user)
            self._send(200, {
                "access_token": token, "token_type": "bearer", "expires_in": 3600,
                "expires_at": int(time.time()) + 3600,
                "refresh_token": "refresh-" + u["id"],
                "user": user_json(u, email),
            })
        elif self.path.startswith("/auth/v1/logout"):
            self._send(204)
        else:
            self._send(404, {"error": "not found"})

    def do_GET(self):
        if self.path.startswith("/auth/v1/user"):
            auth = self.headers.get("Authorization", "")
            token = auth.replace("Bearer ", "")
            try:
                payload = json.loads(base64.urlsafe_b64decode(token.split(".")[1] + "=="))
                email = payload["email"]
                u = USERS[email]
                self._send(200, user_json(u, email))
            except Exception:
                self._send(401, {"error": "invalid token"})
        else:
            self._send(404, {"error": "not found"})

    def log_message(self, *a): pass

print("stub supabase na 9999")
HTTPServer(("127.0.0.1", 9999), H).serve_forever()
