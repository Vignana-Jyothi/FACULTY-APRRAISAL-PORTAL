# Observability

Backend exposes endpoints for Prometheus (metrics), Loki (logs), and Grafana (dashboards over both).

## Endpoints (root path — scrape on internal network only)

| Endpoint | Purpose |
|----------|---------|
| `GET /metrics` | Prometheus exposition — Node defaults (CPU, mem, GC, event loop) + HTTP metrics. Open when `METRICS_TOKEN` is unset; when it is set, requires `Authorization: Bearer <token>` and answers 401 otherwise |
| `GET /health` | Liveness — process up, no DB touch (k8s `livenessProbe`) |
| `GET /health/ready` | Readiness — pings DB (`SELECT 1`); 503 if down (k8s `readinessProbe`) |

> These are at the **root**, not under `/api`. `/health` and `/health/ready`
> stay open for the container and proxy probes. Don't expose `/metrics`
> publicly — restrict via firewall/ingress or put it behind the scrape network,
> and set `METRICS_TOKEN` (adding the matching bearer token to the Prometheus
> scrape config) if it can be reached from anywhere else.

## Metrics emitted

- `http_request_duration_seconds` — histogram, labels `method,route,status_code`
- `http_requests_total` — counter, same labels
- `http_requests_in_flight` — gauge
- `process_*`, `nodejs_*` — default Node/process metrics
- Route label is the matched Express path (or path with ids collapsed to `:id`) to keep cardinality low.

## Logs (Loki)

Structured JSON via `pino` → **stdout**, one line per request.

- Each request gets an `x-request-id` (honored from inbound header or generated) for correlation.
- `authorization` / `cookie` headers redacted.
- Level: `LOG_LEVEL` env (default `debug` dev, `info` prod). 4xx→warn, 5xx→error.
- `/metrics` and `/health` skipped from access logs.

**How logs reach Loki depends on where the backend runs:**

| Backend runs as | How the logs get to Loki |
|-----------------|--------------------------|
| Docker container (production) | Grafana **Alloy** reads every container's stdout through the Docker socket and pushes it to Loki — `monitoring/alloy/config.alloy`, started by `--profile monitoring`. No app change. |
| `npm run dev` / `npm start` on the host | stdout goes to your terminal and nothing ships it. Run the backend in Docker, or add a direct transport (`npm i pino-loki`). |

Alloy replaced Promtail here; Promtail reached end of life in 2026.

## The stack in this repository

Everything is already wired in `docker-compose.prod.yml` under the `monitoring`
profile — there is no sample to copy:

```bash
docker compose -f docker-compose.prod.yml --profile monitoring up -d
```

| Service | Image | Config in the repo | Notes |
|---------|-------|--------------------|-------|
| Prometheus | `prom/prometheus:v3.5.5` | `prometheus.yml` | Scrapes `backend:5000/metrics` every 15 s; retention `PROMETHEUS_RETENTION` (30d) |
| Loki | `grafana/loki:3.7.7` | bundled `local-config.yaml` | No retention limit in that config — watch its disk |
| Alloy | `grafana/alloy:v1.19.2` | `monitoring/alloy/config.alloy` | Docker socket mounted read-only; labels each stream `service` + `container` |
| Grafana | `grafana/grafana:13.2.1` | `monitoring/grafana/provisioning/` | Prometheus and Loki data sources provisioned; login `admin` / `GRAFANA_PASSWORD`; anonymous access off |

The UIs bind to `127.0.0.1` on the server — use an SSH tunnel
(`ssh -L 3000:127.0.0.1:3000 <server>`). Build or import dashboards from the
`http_*` metrics, and query logs in Explore:

```logql
{service="backend"} | json | status_code >= 500
```

## Env

```env
LOG_LEVEL=info     # trace|debug|info|warn|error
```
