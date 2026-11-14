# Gemini & AI Studio Instructions — izinet

> Project: izinet VPN Management Platform (VLESS-Reality + Hysteria2 + Node.js/Express + React + Supabase)

## Key References:
- `AGENTS.md` (Main specification)
- `docs/ANTI_PATTERNS.md` (🚫 Реестр нерабочих методов и антипаттернов обхода блокировок — ЧИТАТЬ ОБЯЗАТЕЛЬНО)
- `docs/ARCHITECTURE.md` (System network & port routing)
- `docs/MULTI_AGENT_GUIDE.md` (Cross-agent protocol)
- `fix.md` (Fix log)

## Golden Directives:
1. **Preserve VPN Operations**: VLESS-Reality and Hysteria2 must remain functional 100% of the time.
2. **Anti-Patterns Registry**: Never re-suggest or revert to failed methods from `docs/ANTI_PATTERNS.md`. If a method fails, record it there immediately.
3. **Ports**: Port 443 is Xray/Reality (TCP) and Hysteria2 (UDP). Port 3443 is Nginx. Port 3005 is Express in Docker/Production (mapped from Nginx `proxy_pass 127.0.0.1:3005`), and Port 3000 is for AI Studio dev. NEVER hardcode `const PORT = 3000` (always use dynamic fallback to 3005 in production).
4. **Audit**: Log any fixes in `fix.md` and check off completed items in `Todo.md`.
5. **Ponytail (Minimalism & YAGNI)**: Follow `/skills/ponytail/` rules — smallest complete change, no bloat/over-engineering, standard library over new dependencies.
