# n8n workflows (reference)

AutoToko reuses the **shared n8n** instance on cosger.online (same one xtracker
uses — see `Knowledge Base/SERVER_KB.md`). All external marketplace integration
logic lives here, not in the NestJS backend (PRD Bagian 2.3 / 12).

Workflow JSON exports are committed here as references (import via
`n8n import:workflow`). Planned workflows (PRD Bagian 12.1):

- `autotoko-wa-login-receiver` — receive WA login messages → verify to backend
- `tiktok-order-webhook`, `shopee-order-webhook`
- `token-refresh-scheduler` (Shopee every 3h), `tiktok-token-refresh` (daily)
- `auto-approve-order`, `ai-chat-buyer`, `ai-chat-affiliate`, `auto-reply-review`
- `daily-report`, `weekly-report`, `product-sync`, `restock-alert`
- `activate-ads`, `trend-analysis`, `billing-deduct`, `balance-alert`

> Editing shared n8n causes a brief blip for xtracker — only restart when needed.
