# WA login — adapting xtracker's shared workflow for AutoToko

AutoToko reuses the **same WhatsApp number + n8n** as xtracker. The existing
workflow **`taruh data mentah (by wa/app)`** (id `SDBMhwhGFhPFKnBi`, active)
already receives all incoming WA messages and routes them in node **`Switch1`**
(id `de7af6c5-...`) by message prefix:

- body contains `XTRACKER-` → node **`Auth`** → `POST api.cosger.online/.../auth/whatsapp-verify`
- otherwise → `Cek isRegister` → raw-data/media pipeline

## The change (additive — does NOT touch xtracker's branches)

1. **Add a 3rd rule to `Switch1`**: body **contains `AUTOTOKO-`** → output `autotoko`.
2. **Add an HTTP Request node `Auth AutoToko`** wired from that output:
   - Method: `POST`
   - URL: `{AUTOTOKO_API_BASE}/api/auth/wa-login/verify`
   - Header: `x-webhook-secret: {WA_WEBHOOK_SECRET}` (AutoToko's own secret — NOT xtracker's)
   - JSON body:
     ```json
     {
       "code": "{{ $json.messages[0].text.body }}",
       "wa_number": "+{{ $json.messages[0].from }}"
     }
     ```
3. **Tighten the raw-data (`no`) rule** so AutoToko codes don't leak into
   xtracker's pipeline: change its condition to
   `notContains "XTRACKER-"` **AND** `notContains "AUTOTOKO-"`.

xtracker's `XTRACKER-` branch and node `Auth` are left exactly as-is.

### Node JSON to import (paste into the workflow, then connect Switch1 → it)

```json
{
  "parameters": {
    "method": "POST",
    "url": "={{ $env.AUTOTOKO_API_BASE }}/api/auth/wa-login/verify",
    "sendHeaders": true,
    "headerParameters": { "parameters": [
      { "name": "x-webhook-secret", "value": "={{ $env.AUTOTOKO_WA_WEBHOOK_SECRET }}" }
    ]},
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "={ \"code\": \"{{ $json.messages[0].text.body }}\", \"wa_number\": \"+{{ $json.messages[0].from }}\" }",
    "options": {}
  },
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.4,
  "name": "Auth AutoToko"
}
```

## Apply procedure (needs approval — restart blips xtracker ~20-30s)

```bash
docker exec n8n n8n export:workflow --id=SDBMhwhGFhPFKnBi --output=/tmp/wf.json  # backup first
# patch JSON (add rule + node + connection), then:
docker cp wf.patched.json n8n:/tmp/wf.json
docker exec n8n n8n import:workflow --input=/tmp/wf.json
docker restart n8n   # required for the active webhook to pick up changes
```

> Frontend generates codes as `AUTOTOKO-XXXXXX` (uppercase, like xtracker's
> `XTRACKER-`) so the shared Switch can disambiguate cleanly. Backend tolerates
> the raw body and extracts the code via regex.
