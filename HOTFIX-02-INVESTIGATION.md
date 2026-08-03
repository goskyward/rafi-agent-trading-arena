# Hotfix 02 — Opportunity Engine Integration Investigation

## Scope

Only the Arena upstream provider, temporary diagnostic route/flags, tests, and deployment configuration were investigated. Trading, scoring, accounting, campaign, round, and Durable Object state logic were not changed.

## Production call path

`GET /health` → `new OpportunityEngineMarketProvider(env).health()` → `fetchJson("/health", 3000)` → `resolveUrl("/health")` → `fetch(resolvedUrl.href)`.

This is the only production upstream health implementation. There is no Cloudflare Service Binding, alternate provider, preview alias, legacy helper, or hardcoded health URL.

## Temporary diagnostic evidence

- Resolved URL: `https://rafi-crypto-movers.camronra2020.workers.dev/health`
- Provider: `OpportunityEngineMarketProvider`
- Path: `/health`
- Arena subrequest result before correction: HTTP 404, `text/plain; charset=UTF-8`
- Direct external result: HTTP 200, `application/json; charset=utf-8`
- Temporary diagnostic Cloudflare version: `0bf0284d-e70c-4d3b-af31-38f9fbece398`

The temporary public diagnostic fields, protected diagnostic route, diagnostic flag, and structured trace logs were removed after evidence capture.

## Root cause and correction

Cloudflare production returned a platform-style plain-text 404 because the Arena and Opportunity Engine are Workers on the same Cloudflare account and the Arena used global `fetch()` without enabling public Worker-to-Worker subrequests. External calls were unaffected, which explains the direct HTTP 200 result.

The mission requires `OPPORTUNITY_ENGINE_BASE_URL` rather than a Service Binding, so `global_fetch_strictly_public` is enabled alongside `nodejs_compat`. The provider retains `new URL()` for safe construction and passes the resulting `.href` string to `fetch()`.

## Runtime variable

- Value: `https://rafi-crypto-movers.camronra2020.workers.dev`
- Length: 51
- Hostname: `rafi-crypto-movers.camronra2020.workers.dev`
- Pathname: `/`
- Trailing path, whitespace, and duplicate slash: none
