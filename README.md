# Buscador de empleos públicos — SERVIR / Talento Perú

Proyecto estático para consultar de forma más cómoda las ofertas publicadas en Talento Perú.

## Arquitectura

- `scraper/scrape.py`: cliente HTTP de JSF/PrimeFaces con `requests` + BeautifulSoup. No usa Selenium.
- `docs/data/jobs.json`: base vigente consumida por la web.
- `docs/`: GitHub Pages en HTML/CSS/JS puro, sin build.
- `.github/workflows/update-jobs.yml`: actualización automática diaria y manual.

## Probar primero con un solo departamento

```bash
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
pip install -r scraper/requirements.txt
python scraper/scrape.py --department 15 --output docs/data/jobs.json
python -m http.server 8000 --directory docs
```

Luego abre `http://localhost:8000`.

## Procesar todo el Perú

```bash
python scraper/scrape.py --output docs/data/jobs.json
```

## Publicar en GitHub Pages

1. Sube este proyecto a un repositorio.
2. En **Settings → Pages**, selecciona **Deploy from a branch**.
3. Elige la rama `main` y la carpeta `/docs`.
4. En **Actions**, ejecuta manualmente `Actualizar convocatorias SERVIR` la primera vez.

El workflow también queda programado una vez al día a las 05:20 (hora de Perú).

## Si SERVIR devuelve 403

El portal puede aplicar reglas distintas según la IP. Si una ejecución de GitHub Actions recibe 403, conviene conservar este scraper HTTP como primera opción y agregar un fallback con Playwright (no Selenium) solo para obtener la sesión/ViewState o ejecutar el scraping completo. No es recomendable aumentar concurrencia ni intentar evadir controles del portal.

## Filtros actuales

- texto libre sobre puesto, entidad, perfil, experiencia, conocimientos y especialización
- departamento
- entidad
- régimen inferido
- sueldo mínimo/máximo
- experiencia máxima
- cierre en 3/7/14 días
- favoritos guardados en el navegador
- orden por cierre, sueldo, publicación o entidad

## Fuente

Los datos provienen del portal oficial Talento Perú de SERVIR. Este proyecto debe presentarse como un buscador independiente y mantener enlaces hacia las bases/convocatorias oficiales.
