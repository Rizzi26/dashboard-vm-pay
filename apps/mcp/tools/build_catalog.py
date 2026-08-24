#!/usr/bin/env python3
"""Gera o catálogo de recursos do MCP a partir da doc oficial vendorizada.

A doc da VMpay é um Sphinx com marcação regular: cada operação aparece num bloco
`<pre>` como `GET /api/v1/vends`, e os parâmetros são bullets
`<strong>nome</strong>: descrição` dentro de subseções nomeadas — "Filtros",
"Campos", "Obrigatórios", "Opcionais", "Parâmetros de URL".

Extrair é melhor que digitar 160 operações à mão: quando a Nayax publicar doc
nova, rodar de novo reconcilia o catálogo em vez de deixá-lo apodrecer.

    python3 apps/mcp/tools/build_catalog.py
"""

from __future__ import annotations

import json
import re
import unicodedata
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DOCS = ROOT / "docs" / "vendor" / "doc_api"
OUT = ROOT / "apps" / "mcp" / "src" / "vmpay_mcp" / "catalog.json"

GROUPS = {
    "registries": "cadastro",
    "reports": "relatorio",
    "info": "dominio",
    "inventory": "inventario",
}

ENDPOINT_RE = re.compile(r"^(GET|POST|PUT|PATCH|DELETE)\s+(/api/v1/\S*)$")

LABEL_TAGS = ("strong", "em")

# Cabeçalho da subseção -> onde o parâmetro entra. O que não está aqui é
# ignorado; "Retorno" e "Erros" também usam bullets em negrito, e aceitá-los
# por omissão encheria os filtros de campos de resposta.
SECTION_KIND = {
    "filtros": "filters",
    "filtro": "filters",
    "campos": "optional",
    "obrigatorios": "required",
    "opcionais": "optional",
    "parametros de url": "url",
}


def normalize(text: str) -> str:
    """Minúsculas, sem acento, sem pontuação de borda e sem o glifo do Sphinx.

    Todo cabeçalho vem com um headerlink na Private Use Area (U+F0C1) grudado no
    fim — "Filtros". Sem tirar isso, nenhuma comparação de cabeçalho casa.
    """
    cleaned = "".join(
        c
        for c in unicodedata.normalize("NFD", text.strip().lower())
        if unicodedata.category(c) not in ("Mn", "Co", "Cf")
    )
    return cleaned.strip().rstrip(":").strip()


class DocPage(HTMLParser):
    """Extrai operações e parâmetros de uma página da doc."""

    def __init__(self) -> None:
        super().__init__()
        self.title = ""
        self.operations: list[dict] = []
        self._sections: list[str] = []
        self._headings: dict[str, str] = {}
        self._capture: list[str] | None = None
        self._in_pre = False
        self._pre: list[str] = []
        self._in_label = False
        self._label: list[str] = []
        self._pending: str | None = None
        self._depth = 0
        # (seção, profundidade na lista, nome, tinha dois-pontos)
        self._params: list[tuple[tuple[str, ...], int, str, bool]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "section":
            self._sections.append(dict(attrs).get("id") or "")
        elif tag in ("h1", "h2", "h3", "h4"):
            self._capture = []
        elif tag == "pre":
            self._in_pre, self._pre = True, []
        elif tag == "ul":
            # Fecha antes de descer: o envelope é o rótulo que abre a lista
            # aninhada, e ele tem que ficar registrado na profundidade de cima.
            self._flush()
            self._depth += 1
        elif tag in LABEL_TAGS:
            # Filtros vêm em <strong>, campos de corpo em <em>. Aceitamos os dois.
            self._in_label, self._label = True, []

    def handle_endtag(self, tag: str) -> None:
        if tag == "section" and self._sections:
            self._sections.pop()
        elif tag in ("h1", "h2", "h3", "h4") and self._capture is not None:
            text = "".join(self._capture).strip()
            if self._sections:
                self._headings.setdefault(self._sections[-1], text)
            if tag == "h1" and not self.title:
                self.title = normalize_title(text)
            self._capture = None
        elif tag == "pre" and self._in_pre:
            self._in_pre = False
            self._record_endpoint("".join(self._pre))
        elif tag == "ul":
            self._flush()
            self._depth = max(0, self._depth - 1)
        elif tag == "li":
            self._flush()
        elif tag in LABEL_TAGS and self._in_label:
            self._in_label = False
            self._flush()
            name = "".join(self._label).strip().rstrip(":")
            # Candidato. A confirmação vem do texto seguinte: um parâmetro é
            # sempre "<strong>nome</strong>: descrição". Sem checar o dois-pontos,
            # o negrito de ênfase no meio de uma frase — "passar a data e também
            # a **hora**" — entraria como se fosse filtro.
            self._pending = name if re.fullmatch(r"[a-z][a-z0-9_]*", name) else None

    def _flush(self, has_colon: bool = False) -> None:
        """Fecha o rótulo pendente.

        Um rótulo seguido de ":" é um parâmetro. Um rótulo sem ":" e com lista
        aninhada logo abaixo é o envelope do corpo — a doc escreve o body de
        POST /products como <em>product</em> com os campos dentro, porque a API
        espera {"product": {...}}.
        """
        if self._pending is not None:
            self._params.append((tuple(self._sections), self._depth, self._pending, has_colon))
            self._pending = None

    def handle_data(self, data: str) -> None:
        if self._pending is not None and not self._in_label and data.strip():
            self._flush(has_colon=data.lstrip().startswith(":"))
        if self._capture is not None:
            self._capture.append(data)
        if self._in_pre:
            self._pre.append(data)
        if self._in_label:
            self._label.append(data)

    def _record_endpoint(self, text: str) -> None:
        for line in text.splitlines():
            m = ENDPOINT_RE.match(line.strip())
            if m:
                self.operations.append(
                    {
                        "method": m.group(1),
                        "path": m.group(2).removeprefix("/api/v1/"),
                        "section": tuple(self._sections),
                    }
                )

    def _kind_of(self, section: tuple[str, ...], depth: int) -> str | None:
        """Classifica o parâmetro pelo cabeçalho mais próximo que a gente conhece.

        "Obrigatórios" e "Opcionais" ficam aninhados dentro de "Campos", então a
        busca vai da subseção mais funda para fora e para no primeiro cabeçalho
        reconhecido — que é o mais específico.
        """
        for i in range(len(section) - 1, depth - 1, -1):
            kind = SECTION_KIND.get(normalize(self._headings.get(section[i], "")))
            if kind:
                return kind
        return None

    def finish(self) -> list[dict]:
        for op in self.operations:
            own = op["section"]
            mine = [
                (depth, name, colon, self._kind_of(section, len(own)))
                for section, depth, name, colon in self._params
                if len(section) > len(own) and section[: len(own)] == own
            ]
            buckets: dict[str, list[str]] = {
                "filters": [], "required": [], "optional": [], "url": []
            }
            envelope = None
            for kind in buckets:
                entries = [(d, n, c) for d, n, c, k in mine if k == kind]
                labelled = [(d, n) for d, n, c in entries if c]
                if not labelled:
                    continue
                # Só o nível mais raso é parâmetro de fato; o que estiver mais
                # fundo são atributos de objetos aninhados (additional_barcodes,
                # alternatives), que pertencem ao corpo mas não à assinatura.
                top = min(d for d, _ in labelled)
                for depth, name in labelled:
                    if depth == top and name not in buckets[kind]:
                        buckets[kind].append(name)
                # Rótulo sem dois-pontos acima do nível dos campos é o envelope
                # do corpo: {"product": {...}}.
                if kind in ("required", "optional") and envelope is None:
                    for depth, name, colon in entries:
                        if not colon and depth < top:
                            envelope = name
                            break
            buckets["optional"] = [
                f for f in buckets["optional"] if f not in buckets["required"]
            ]
            op.update(buckets)
            op["envelope"] = envelope
            op["deprecated"] = any("obsolet" in part for part in own)
            op["section"] = "/".join(own)
        return self.operations


def normalize_title(text: str) -> str:
    return "".join(
        c for c in text.strip() if unicodedata.category(c) not in ("Co", "Cf")
    ).strip()


def path_template(path: str) -> str:
    """`machines/[machine_id]/installations/[id]` -> `.../{machine_id}/.../{id}`."""
    return re.sub(r"\[(\w+)\]", r"{\1}", path)


def collection_key(path: str) -> str:
    """Nome estável do recurso: o último segmento que não é placeholder."""
    segments = [s for s in path.split("/") if s and not s.startswith("{")]
    return segments[-1] if segments else path


def classify(method: str, path: str) -> str:
    last = path.rstrip("/").split("/")[-1]
    is_member = last.startswith("{")
    if method == "GET":
        return "get" if is_member else "list"
    if method == "DELETE":
        return "delete"
    if method == "POST":
        return "create" if not is_member else f"action:{last}"
    if method in ("PATCH", "PUT"):
        return "update" if is_member else f"action:{last}"
    return method.lower()


def weight(op: dict) -> int:
    return len(op["filters"]) + len(op["required"]) + len(op["optional"])


def build() -> dict:
    resources: dict[str, dict] = {}
    for group_dir, group in GROUPS.items():
        for html in sorted((DOCS / group_dir).rglob("*.html")):
            page = DocPage()
            page.feed(html.read_text(encoding="utf-8", errors="replace"))
            ops = page.finish()
            if not ops:
                continue
            doc_ref = str(html.relative_to(DOCS))
            for op in ops:
                raw = path_template(op["path"]).split("?", 1)[0].rstrip("/")
                if not raw:
                    continue
                key = collection_key(raw)
                entry = resources.setdefault(
                    key,
                    {
                        "resource": key,
                        "label": page.title,
                        "group": group,
                        "doc": doc_ref,
                        "path_params": [],
                        "operations": {},
                    },
                )
                verb = classify(op["method"], raw)
                shaped = {
                    "method": op["method"],
                    "path": raw,
                    "filters": op["filters"],
                    "required": op["required"],
                    "optional": op["optional"],
                    "envelope": op["envelope"],
                }
                if op["deprecated"]:
                    entry["deprecated"] = True
                # A mesma operação aparece em três páginas de pick list, uma por
                # estratégia de status. Fica a versão mais completa.
                previous = entry["operations"].get(verb)
                if previous and weight(previous) >= weight(shaped):
                    continue
                entry["operations"][verb] = shaped
                for name in re.findall(r"\{(\w+)\}", raw):
                    if name != "id" and name not in entry["path_params"]:
                        entry["path_params"].append(name)
    return {"resources": dict(sorted(resources.items()))}


if __name__ == "__main__":
    catalog = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
    res = catalog["resources"]
    ops = sum(len(r["operations"]) for r in res.values())
    documented = sum(
        1 for r in res.values() for o in r["operations"].values() if weight(o)
    )
    print(f"{len(res)} recursos, {ops} operações ({documented} com parâmetros) -> {OUT.relative_to(ROOT)}")
