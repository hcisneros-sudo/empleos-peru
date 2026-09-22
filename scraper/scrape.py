#!/usr/bin/env python3
"""Scraper HTTP para Talento Perú (SERVIR), sin Selenium.

El portal usa JSF/PrimeFaces. El flujo es:
1) GET inicial para obtener cookie de sesión + javax.faces.ViewState.
2) POST JSF para filtrar por departamento y paginar.
3) POST del botón "Ver más" + GET de la vista detalle.
4) Exporta JSON estático para GitHub Pages.

Los IDs JSF pueden cambiar si SERVIR rediseña la vista. El script falla con
mensajes explícitos para que sea sencillo actualizar los selectores.
"""
from __future__ import annotations

import argparse
import hashlib
import html as html_lib
import json
import logging
import random
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Iterable
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://app.servir.gob.pe/DifusionOfertasExterno/faces/consultas/"
LIST_URL = urljoin(BASE_URL, "ofertas_laborales.xhtml")
DETAIL_URL = urljoin(BASE_URL, "detalle_ofertas_laborales.xhtml")
SOURCE_URL = LIST_URL

FORM = "frmLstOfertsLabo"
BTN_SEARCH = f"{FORM}:j_idt42"
BTN_PREV = f"{FORM}:j_idt54"
BTN_NEXT = f"{FORM}:j_idt56"
BTN_LAST = f"{FORM}:j_idt57"
DETAIL_BUTTON_SUFFIX = "j_idt71"

DEPARTMENTS = {
    "01": "AMAZONAS", "02": "ANCASH", "03": "APURIMAC", "04": "AREQUIPA",
    "05": "AYACUCHO", "06": "CAJAMARCA", "07": "CALLAO", "08": "CUSCO",
    "09": "HUANCAVELICA", "10": "HUANUCO", "11": "ICA", "12": "JUNIN",
    "13": "LA LIBERTAD", "14": "LAMBAYEQUE", "15": "LIMA", "16": "LORETO",
    "17": "MADRE DE DIOS", "18": "MOQUEGUA", "19": "PASCO", "20": "PIURA",
    "21": "PUNO", "22": "SAN MARTIN", "23": "TACNA", "24": "TUMBES",
    "25": "UCAYALI",
}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-PE,es;q=0.9,en;q=0.7",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
}

LIMA_TZ = timezone(timedelta(hours=-5))


@dataclass
class PageState:
    view_state: str
    html: str


def clean(text: str | None) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def parse_number(text: str | None) -> float | None:
    if not text:
        return None
    t = text.replace("S/.", "").replace("S/", "").replace(" ", "")
    # Usualmente SERVIR usa coma de miles y punto decimal.
    t = t.replace(",", "")
    m = re.search(r"\d+(?:\.\d+)?", t)
    return float(m.group()) if m else None


def parse_int(text: str | None) -> int | None:
    m = re.search(r"\d+", text or "")
    return int(m.group()) if m else None


def parse_experience_months(text: str | None) -> int | None:
    t = clean(text).lower()
    if not t:
        return None
    if any(x in t for x in ("sin experiencia", "no requiere", "no se requiere")):
        return 0
    years = re.search(r"(\d+(?:[.,]\d+)?)\s*a(?:ñ|n)os?", t)
    months = re.search(r"(\d+)\s*mes(?:es)?", t)
    total = 0
    found = False
    if years:
        total += round(float(years.group(1).replace(",", ".")) * 12)
        found = True
    if months:
        total += int(months.group(1))
        found = True
    return total if found else None


def infer_regime(text: str | None) -> str:
    t = clean(text).upper()
    if "1057" in t or "CAS" in t:
        return "CAS / D. Leg. 1057"
    if "728" in t:
        return "D. Leg. 728"
    if "276" in t:
        return "D. Leg. 276"
    if "SERVICIO CIVIL" in t or "30057" in t:
        return "Ley del Servicio Civil"
    if "PRACT" in t:
        return "Prácticas"
    return "Otros / no identificado"


def soup(html: str) -> BeautifulSoup:
    return BeautifulSoup(html, "lxml")


def get_view_state_from_html(doc: str) -> str | None:
    tag = soup(doc).find("input", {"name": "javax.faces.ViewState"})
    return tag.get("value") if tag else None


def decode_jsf_response(text: str, previous_view_state: str) -> PageState:
    """Convierte una respuesta AJAX parcial de JSF en HTML útil."""
    if "<partial-response" not in text:
        return PageState(get_view_state_from_html(text) or previous_view_state, text)

    xml = BeautifulSoup(text, "xml")
    new_state = previous_view_state
    fragments: list[str] = []
    for upd in xml.find_all("update"):
        upd_id = upd.get("id", "")
        raw = upd.get_text() or ""
        if "ViewState" in upd_id:
            new_state = clean(raw)
        else:
            fragments.append(html_lib.unescape(raw))
    return PageState(new_state, "\n".join(fragments))


def base_payload(view_state: str, dep: str) -> dict[str, str]:
    return {
        FORM: FORM,
        f"{FORM}:modalidadAcceso": "03",
        f"{FORM}:txtPerfil": "",
        f"{FORM}:cboDep_focus": "",
        f"{FORM}:cboDep_input": dep,
        f"{FORM}:txtPuesto": "",
        f"{FORM}:autocompletar_input": "",
        f"{FORM}:autocompletar_hinput": "",
        f"{FORM}:txtNroConv": "",
        "javax.faces.ViewState": view_state,
    }


def ajax_payload(view_state: str, dep: str, source: str) -> dict[str, str]:
    p = base_payload(view_state, dep)
    p.update({
        "javax.faces.partial.ajax": "true",
        "javax.faces.source": source,
        "javax.faces.partial.execute": "@all",
        "javax.faces.partial.render": f"{FORM}:mensaje {FORM}",
        source: source,
    })
    return p


class ServirScraper:
    def __init__(self, timeout: int = 60, polite_delay: float = 0.20):
        self.timeout = timeout
        self.polite_delay = polite_delay
        self.session = requests.Session()
        self.session.headers.update(HEADERS)

    def sleep(self) -> None:
        time.sleep(self.polite_delay + random.uniform(0.03, 0.12))

    def request(self, method: str, url: str, **kwargs) -> requests.Response:
        last_error: Exception | None = None
        for attempt in range(1, 4):
            try:
                r = self.session.request(method, url, timeout=self.timeout, **kwargs)
                r.raise_for_status()
                return r
            except requests.RequestException as exc:
                last_error = exc
                if attempt == 3:
                    break
                time.sleep(attempt * 2)
        raise RuntimeError(f"No se pudo acceder a SERVIR: {last_error}")

    def start(self) -> PageState:
        r = self.request("GET", LIST_URL)
        vs = get_view_state_from_html(r.text)
        if not vs:
            raise RuntimeError(
                "SERVIR respondió, pero no se encontró javax.faces.ViewState. "
                "Puede haber cambiado la vista o activado una protección anti-bot."
            )
        return PageState(vs, r.text)

    def navigate(self, state: PageState, dep: str, source: str) -> PageState:
        r = self.request("POST", LIST_URL, data=ajax_payload(state.view_state, dep, source))
        self.sleep()
        return decode_jsf_response(r.text, state.view_state)

    def search_department(self, state: PageState, dep: str) -> PageState:
        return self.navigate(state, dep, BTN_SEARCH)

    def next_page(self, state: PageState, dep: str) -> PageState:
        return self.navigate(state, dep, BTN_NEXT)

    def page_count(self, doc: str) -> int:
        s = soup(doc)
        lbl = s.find("label", class_=lambda c: c and "btn-paginator-cnt" in c)
        nums = [int(n) for n in re.findall(r"\d+", clean(lbl.get_text(" ") if lbl else ""))]
        return nums[-1] if nums else 1

    def cards(self, doc: str) -> list[dict]:
        out = []
        for idx, card in enumerate(soup(doc).find_all("div", class_="cuadro-vacantes")):
            title_el = card.find("div", class_="titulo-vacante")
            title = clean(title_el.get_text(" ") if title_el else "")
            entity_el = card.find("div", class_="nombre-entidad")
            entity = clean(entity_el.get_text(" ") if entity_el else "")

            fields: dict[str, str] = {}
            for lab in card.find_all("span", class_="sub-titulo"):
                key = clean(lab.get_text(" ")).rstrip(":").lower()
                val = lab.find_next_sibling("span", class_="detalle-sp")
                if val is None and lab.parent:
                    val = lab.parent.find("span", class_="detalle-sp")
                fields[key] = clean(val.get_text(" ") if val else "")

            # Fallback: el layout histórico entrega los valores en orden fijo.
            details = [clean(x.get_text(" ")) for x in card.find_all("span", class_="detalle-sp")]
            out.append({"_index": idx, "job_title": title, "public_institution": entity, "_fields": fields, "_details": details})
        return out

    def open_detail(self, state: PageState, dep: str, card_index: int) -> tuple[PageState, str]:
        # El botón de cada tarjeta históricamente usa idPnlRepeatPuestos:{i}:j_idt71.
        source = f"{FORM}:idPnlRepeatPuestos:{card_index}:{DETAIL_BUTTON_SUFFIX}"
        p = base_payload(state.view_state, dep)
        p[source] = ""
        r = self.request("POST", LIST_URL, data=p)
        state2 = PageState(get_view_state_from_html(r.text) or state.view_state, r.text)
        self.sleep()
        d = self.request("GET", DETAIL_URL)
        self.sleep()
        return state2, d.text

    def parse_detail(self, doc: str) -> dict:
        s = soup(doc)
        sections = s.find_all("div", class_="seccion-detalle")
        if not sections:
            return {}

        result: dict[str, str | float | int | None] = {}
        header = sections[0]
        p = header.find("span", class_="sp-aviso0")
        e = header.find("span", class_="sp-aviso")
        if p:
            result["job_title"] = clean(p.get_text(" "))
        if e:
            result["public_institution"] = clean(e.get_text(" "))

        body = sections[1] if len(sections) > 1 else sections[0]
        for lab in body.find_all("span", class_=["sub-titulo", "sub-titulo-2"]):
            key = clean(lab.get_text(" ")).rstrip(":").lower()
            val_el = lab.find_next("span")
            value = clean(val_el.get_text(" ") if val_el else "")
            if not value:
                continue
            if "cantidad de vacantes" in key:
                result["vacancies"] = parse_int(value)
            elif "número de convocatoria" in key or "numero de convocatoria" in key:
                result["job_posting_number"] = value
            elif "remuneración" in key or "remuneracion" in key:
                result["salary_text"] = value
                result["salary"] = parse_number(value)
            elif "fecha inicio" in key:
                result["start_publication_date"] = value
            elif "fecha fin" in key:
                result["end_publication_date"] = value
            elif "experiencia" in key:
                result["required_experience"] = value
                result["experience_months"] = parse_experience_months(value)
            elif "formación académica" in key or "formacion academica" in key:
                result["educational_background"] = value
            elif "especialización" in key or "especializacion" in key:
                result["specialization"] = value
            elif "conocimiento" in key:
                result["required_knowledge"] = value
            elif "competencia" in key:
                result["skills"] = value
            elif key == "detalle" or key.startswith("detalle"):
                a = val_el.find("a", href=True) if val_el else None
                href = a.get("href") if a else value
                if href and href != "#":
                    result["job_posting_url"] = href if href.startswith("http") else "https://" + href.lstrip("/")

        # Segunda pasada para el enlace oficial, porque puede estar en un span vecino.
        for lab in body.find_all("span", class_="sub-titulo"):
            if clean(lab.get_text(" ")).lower().startswith("detalle"):
                a = lab.find_next("a", href=True)
                if a and a.get("href") not in (None, "#"):
                    href = a["href"]
                    result["job_posting_url"] = href if href.startswith("http") else "https://" + href.lstrip("/")
                    break
        return result

    def normalize_card(self, card: dict, dep_name: str) -> dict:
        f = card.pop("_fields", {})
        d = card.pop("_details", [])
        out = {**card, "department": dep_name}
        # Estas claves dependen del texto visible; los fallback quedan en detalle.
        for k, v in f.items():
            if "ubicaci" in k:
                out["location"] = v
            elif "convocatoria" in k:
                out["job_posting_number"] = v
            elif "vacante" in k or "plaza" in k:
                out["vacancies"] = parse_int(v)
            elif "remuner" in k:
                out["salary_text"] = v
                out["salary"] = parse_number(v)
            elif "fecha inicio" in k:
                out["start_publication_date"] = v
            elif "fecha fin" in k:
                out["end_publication_date"] = v
        if "location" not in out:
            out["location"] = dep_name
        if d:
            out["card_raw"] = d
        return out

    def scrape_department(self, start_state: PageState, dep: str) -> list[dict]:
        name = DEPARTMENTS[dep]
        logging.info("Departamento %s (%s)", name, dep)
        state = self.search_department(start_state, dep)
        total_pages = self.page_count(state.html)
        logging.info("  páginas detectadas: %s", total_pages)
        jobs: list[dict] = []

        for page_num in range(1, total_pages + 1):
            cards = self.cards(state.html)
            logging.info("  página %s/%s: %s ofertas", page_num, total_pages, len(cards))
            for card in cards:
                base = self.normalize_card(dict(card), name)
                idx = int(base.pop("_index"))
                try:
                    state, detail_html = self.open_detail(state, dep, idx)
                    base.update(self.parse_detail(detail_html))
                except Exception as exc:
                    logging.warning("    detalle %s falló: %s", idx, exc)
                base["department"] = name
                base["regime"] = infer_regime(base.get("job_posting_number"))
                key = "|".join([
                    str(base.get("job_posting_number") or ""),
                    str(base.get("public_institution") or ""),
                    str(base.get("job_title") or ""),
                ])
                base["id"] = hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]
                base["source"] = "SERVIR - Talento Perú"
                base["source_url"] = SOURCE_URL
                jobs.append(base)
            if page_num < total_pages:
                state = self.next_page(state, dep)
        return jobs


def dedupe(jobs: Iterable[dict]) -> list[dict]:
    by_id: dict[str, dict] = {}
    for job in jobs:
        jid = str(job.get("id"))
        if jid not in by_id:
            by_id[jid] = job
        else:
            # Una misma convocatoria puede aparecer asociada a más de un departamento.
            prev = by_id[jid]
            deps = {x for x in [prev.get("department"), job.get("department")] if x}
            prev["department"] = " / ".join(sorted(deps))
    return list(by_id.values())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", default="docs/data/jobs.json")
    ap.add_argument("--department", help="Código 01-25. Si se omite, procesa todo el Perú.")
    ap.add_argument("--timeout", type=int, default=60)
    ap.add_argument("--delay", type=float, default=0.20)
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if args.department and args.department not in DEPARTMENTS:
        ap.error("--department debe estar entre 01 y 25")

    scraper = ServirScraper(timeout=args.timeout, polite_delay=args.delay)
    initial = scraper.start()
    deps = [args.department] if args.department else list(DEPARTMENTS)
    all_jobs: list[dict] = []
    for dep in deps:
        # Reiniciar la vista por departamento reduce el riesgo de arrastrar estado JSF.
        state = scraper.start() if all_jobs else initial
        try:
            all_jobs.extend(scraper.scrape_department(state, dep))
        except Exception as exc:
            logging.exception("Falló departamento %s: %s", dep, exc)

    jobs = dedupe(all_jobs)
    jobs.sort(key=lambda x: (str(x.get("end_publication_date") or ""), str(x.get("public_institution") or "")))
    payload = {
        "generated_at": datetime.now(LIMA_TZ).isoformat(timespec="seconds"),
        "source": "SERVIR - Talento Perú",
        "source_url": SOURCE_URL,
        "count": len(jobs),
        "jobs": jobs,
    }
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    logging.info("Guardadas %s ofertas en %s", len(jobs), out)
    return 0 if jobs else 2


if __name__ == "__main__":
    raise SystemExit(main())
