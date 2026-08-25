"""Stub do FastAPI com as rotas novas, papel por token e dados plausíveis."""
import base64, json, math, random
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer

random.seed(7)
hoje = date(2026, 8, 24)
dias = [hoje - timedelta(days=i) for i in range(29, -1, -1)]

def receita(i, d):
    base = 900 + 260 * math.sin(i / 4.2)
    return round((base + random.uniform(-140, 190)) * (0.55 if d.weekday() >= 5 else 1.0), 2)

DAILY = [{"dia": d.isoformat(), "faturamento": receita(i, d), "transacoes": random.randint(70, 260)}
         for i, d in enumerate(dias)]
TOTAL = sum(p["faturamento"] for p in DAILY); TX = sum(p["transacoes"] for p in DAILY)

ROLES = {
    "11111111-1111-1111-1111-111111111111": "master",
    "22222222-2222-2222-2222-222222222222": "viewer",
}

STOCK = [
    {"location_id": "aaa", "local": "Condomínio Jardins — 1072", "product_id": "p1",
     "produto": "Água Mineral 500ml", "barcode": "7891000100103", "preco": 3.5,
     "quantidade": 18, "atualizado_em": "2026-08-24T13:50:00Z"},
    {"location_id": "aaa", "local": "Condomínio Jardins — 1072", "product_id": "p2",
     "produto": "Ruffles 50g", "barcode": "7892840222949", "preco": 8.0,
     "quantidade": 4, "atualizado_em": "2026-08-24T13:50:00Z"},
    {"location_id": "aaa", "local": "Condomínio Jardins — 1072", "product_id": "p3",
     "produto": "Coca-Cola Lata 350ml", "barcode": "7894900011517", "preco": 5.5,
     "quantidade": 22, "atualizado_em": "2026-08-24T13:50:00Z"},
]

MEMBERS = [
    {"user_id": "11111111-1111-1111-1111-111111111111", "email": "master@mercadinho.dev",
     "role": "master", "member_since": "2026-08-01T00:00:00Z"},
    {"user_id": "22222222-2222-2222-2222-222222222222", "email": "viewer@mercadinho.dev",
     "role": "viewer", "member_since": "2026-08-10T00:00:00Z"},
]

class H(BaseHTTPRequestHandler):
    def _who(self):
        try:
            token = self.headers.get("Authorization", "").replace("Bearer ", "")
            payload = json.loads(base64.urlsafe_b64decode(token.split(".")[1] + "=="))
            return payload["sub"], payload.get("email")
        except Exception:
            return None, None

    def _send(self, code, body=None, ct="application/json", headers=None):
        self.send_response(code)
        self.send_header("Content-Type", ct)
        self.send_header("Access-Control-Allow-Origin", "http://localhost:3210")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if body is not None:
            self.wfile.write(body if isinstance(body, bytes) else json.dumps(body).encode())

    def do_OPTIONS(self):
        self._send(204)

    def _role(self):
        sub, _ = self._who()
        return ROLES.get(sub)

    def do_GET(self):
        sub, email = self._who()
        if sub is None:
            self._send(401, {"detail": "credencial ausente"}); return
        path = self.path.split("?")[0]
        role = ROLES.get(sub, "viewer")
        if path == "/me":
            self._send(200, {"user_id": sub, "email": email, "platform_admin": False,
                             "organizations": [{"slug": "mercadinho", "name": "Mercadinho do Condomínio", "role": role}]})
        elif path == "/orgs/mercadinho/sales/summary":
            self._send(200, {"periodo": {"inicio": dias[0].isoformat(), "fim": hoje.isoformat()},
                             "faturamento": round(TOTAL, 2), "transacoes": TX, "itens": TX * 1.2,
                             "descontos": 412.5, "maquinas_ativas": 3,
                             "ticket_medio": round(TOTAL / TX, 2)})
        elif path == "/orgs/mercadinho/sales/daily":
            self._send(200, DAILY)
        elif path == "/orgs/mercadinho/sales/by-machine":
            self._send(200, [{"machine_id": 3184, "patrimonio": "1072", "modelo": "Micro Market",
                              "faturamento": 6120.40, "transacoes": 812}])
        elif path == "/orgs/mercadinho/sales/sync-status":
            self._send(200, [{"recurso": "cashless_facts", "cursor": 16732372, "registros_ingeridos": 48211,
                              "ultima_execucao": "2026-08-24T13:50:00Z", "ultimo_sucesso": "2026-08-24T13:50:00Z",
                              "ultimo_erro": None, "atraso_segundos": 420}])
        elif path == "/orgs/mercadinho/stock":
            self._send(200, STOCK)
        elif path == "/orgs/mercadinho/stock/export.csv":
            csv = "local;produto;codigo_barras;preco;quantidade;atualizado_em\n"
            for r in STOCK:
                csv += f"{r['local']};{r['produto']};{r['barcode']};{str(r['preco']).replace('.', ',')};{r['quantidade']};{r['atualizado_em']}\n"
            self._send(200, csv.encode(), ct="text/csv; charset=utf-8",
                       headers={"Content-Disposition": 'attachment; filename="estoque.csv"'})
        elif path == "/orgs/mercadinho/members":
            if role != "master":
                self._send(403, {"detail": "esta ação exige papel master; o seu é " + role}); return
            self._send(200, MEMBERS)
        elif path == "/orgs/mercadinho/stock/actions":
            if role == "viewer":
                self._send(403, {"detail": "esta ação exige papel admin; o seu é viewer"}); return
            self._send(200, [])
        else:
            self._send(404, {"detail": "não existe"})

    def do_POST(self):
        sub, _ = self._who()
        role = ROLES.get(sub or "", "viewer")
        path = self.path.split("?")[0]
        length = int(self.headers.get("Content-Length", 0))
        data = json.loads(self.rfile.read(length) or b"{}")
        if path == "/orgs/mercadinho/stock/restock":
            if role == "viewer":
                self._send(403, {"detail": "esta ação exige papel admin; o seu é viewer"}); return
            qty = data["items"][0]["quantity"]
            pid = data["items"][0]["product_id"]
            for r in STOCK:
                if r["product_id"] == pid:
                    r["quantidade"] += qty
            self._send(201, {"action_id": 77, "status": "success", "vmpay": {"id": 900}})
        elif path == "/orgs/mercadinho/stock/price":
            if role == "viewer":
                self._send(403, {"detail": "esta ação exige papel admin; o seu é viewer"}); return
            for r in STOCK:
                if r["product_id"] == data["product_id"]:
                    r["preco"] = data["price"]
            self._send(200, {"action_id": 78, "status": "success", "vmpay": {"ok": True}})
        elif path == "/orgs/mercadinho/members":
            if role != "master":
                self._send(403, {"detail": "esta ação exige papel master"}); return
            MEMBERS.append({"user_id": "33333333-3333-3333-3333-333333333333",
                            "email": data["email"], "role": data["role"],
                            "member_since": "2026-08-24T14:00:00Z"})
            self._send(201, {"user_id": "3333", "email": data["email"], "role": data["role"]})
        else:
            self._send(404, {"detail": "não existe"})

    def log_message(self, *a): pass

print("stub backend na 8123")
HTTPServer(("127.0.0.1", 8123), H).serve_forever()
