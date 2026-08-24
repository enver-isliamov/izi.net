# Claude Code Instructions — izinet

> You are working on the **izinet** project (modular VPN service platform with VLESS-Reality & Hysteria2).
> **Primary Rule:** NEVER break VLESS, Hysteria2, billing, or existing features.

## 📖 Mandatory Reading Before Any Task:
1. `AGENTS.md` — Single source of truth for architectural guidelines and security rules.
2. `docs/ARCHITECTURE.md` — Network layout (Xray 443 ⇄ Nginx 3443 ⇄ Hysteria2 UDP ⇄ Node.js 3000).
3. `fix.md` — Audit log of resolved bugs (never delete past entries; always log new fixes).
4. `Todo.md` — Global task queue.

## ⚡ Quick Rules:
- **Reality keys**: Stored ONLY in 3x-ui SQLite database (`x-ui.db`). NEVER hardcode in `.env` or Supabase.
- **Inbounds provisioning**: If 3x-ui `addClient` returns 404, the codebase uses `addClientViaFullUpdate`. Keep this fallback intact.
- **Nginx & Ports**: Nginx listens on port **3443**, Xray listens on port **443**. Reality target must be `host.docker.internal:3443`.
- **Hysteria 2**: Uses UDP on port 443 (ensure UFW allows 443/udp).
- **Code comments**: Tag significant bug fixes with `// FIX-ID: Description`.
- **Validation**: Always run `npm run lint` and `npm run build` before concluding changes.
