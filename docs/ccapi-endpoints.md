# CCAPI Endpoint Reference

> Verified against Canon EOS R6 Mark II over HTTPS (port 443, self-signed cert).
> All calls are made server-side only (SvelteKit `+server.ts` routes).
> Base URL: `https://{CAMERA_IP}` (default port 443)

---

## API Version Map

The R6 Mark II exposes three API versions. Tethr uses:

| Feature | Endpoint version |
|---|---|
| Contents listing & file access | `ver120` |
| Event polling (new shot) | `ver110` |
| Device info, battery, lens | `ver100` |

Discover all supported endpoints at `GET /ccapi`.

---

## Authentication

CCAPI on the R6 Mark II supports optional user authentication.
For local WiFi use, authentication is typically disabled.
If enabled, use HTTP Basic Auth on every request.

The camera uses a **self-signed TLS certificate** — client must skip cert verification
(`rejectUnauthorized: false` in Tethr's `cameraFetch()`).

---

## Endpoints

### CCAPI capabilities

```
GET /ccapi
```

Returns a JSON object with all supported API versions and their endpoints,
each annotated with supported HTTP methods. Use this to verify the camera
is reachable and CCAPI is enabled.

---

### List storage

```
GET /ccapi/ver120/contents
GET /ccapi/ver120/contents/card1
```

**Response:**
```json
{
  "path": ["/ccapi/ver120/contents/card1/100EOSR6"]
}
```

---

### List folder (shooting session)

```
GET /ccapi/ver120/contents/card1/100EOSR6
```

**Response:**
```json
{
  "path": [
    "/ccapi/ver120/contents/card1/100EOSR6/4E5A7113.CR3",
    "/ccapi/ver120/contents/card1/100EOSR6/4E5A7114.CR3"
  ]
}
```

Note: Files are CR3 (Canon RAW), not JPG.

---

### Fetch thumbnail

```
GET /ccapi/ver120/contents/card1/100EOSR6/4E5A7113.CR3?kind=thumbnail
```

**Response:** JPEG bytes (`Content-Type: image/jpeg`, ~13 KB)

Small, fast. Use for immediate photo card display.

---

### Fetch full-resolution original

```
GET /ccapi/ver120/contents/card1/100EOSR6/4E5A7113.CR3?kind=original
```

**Response:** CR3 bytes (Canon RAW format, large)

⚠️ Note: `kind=small` returns HTTP 400 — only `thumbnail` and `original` are supported.

---

### Real-time event stream (new shots, settings changes)

```
GET /ccapi/ver100/event/monitoring
DELETE /ccapi/ver100/event/monitoring   ← stop/reset session
```

**Behaviour:** Opens a persistent HTTP connection that streams binary-framed JSON chunks continuously. **This is the correct streaming endpoint** — not `ver110/event/polling` (which returns immediately and is not blocking on this camera).

**Binary frame format:**
```
ff ffff 00 02 00 00 00 [4-byte big-endian length] [JSON bytes]
```

Each frame contains a JSON object with changed camera state. Only `addedcontents` frames are relevant for Tethr.

**Frame on new shot:**
```json
{
  "addedcontents": ["/ccapi/ver120/contents/card1/100EOSR6/4E5A7114.CR3"]
}
```

**Other frame types** (ignored by Tethr): `av`, `tv`, `iso`, `recordable`, `effective_value_av`, etc. — camera settings that change continuously.

**Empty frame** (heartbeat / no-op):
```json
{}
```

**Tethr SSE route behaviour:**
1. DELETE any existing session (both `ver100/event/monitoring` and `ver110/event/polling`)
2. GET monitoring stream, read body as streaming bytes
3. Parse binary frames from accumulated buffer
4. On `addedcontents`: split path → `dirname` + `filename`, emit `shot` SSE event
5. On stream end or error: exponential back-off (1s → max 30s), DELETE + reconnect
6. On client disconnect: DELETE to release camera session immediately

⚠️ Camera allows **only one** active monitoring session — a stuck session causes HTTP 503 on reconnect. Always DELETE before starting.

---

### Shooting settings (all at once)

```
GET /ccapi/ver100/shooting/settings
```

**Verified on:** R6 Mark II, EOS R50

**Response:** JSON object with all current shooting settings. Each key maps to `{ value, ability[] }`:

```json
{
  "shootingmodedial": { "value": "m", "ability": ["m"] },
  "av":               { "value": "f3.2", "ability": ["f2.8", "f3.2", ...] },
  "tv":               { "value": "1/60",  "ability": [...] },
  "iso":              { "value": "3200",  "ability": ["auto", "100", ...] },
  "exposure":         { "value": "+0.0",  "ability": [...] },
  "wb":               { "value": "auto",  "ability": [...] },
  "colortemperature": { "value": 5500,    "ability": [...] },
  "afoperation":      { "value": "oneshot", "ability": [...] },
  "metering":         { "value": "evaluative", "ability": [...] },
  "drive":            { "value": "single", "ability": [...] }
}
```

Used by Tethr to populate the status bar immediately on connect (background fetch after monitoring stream opens).

---

### Battery status

```
GET /ccapi/ver100/devicestatus/battery
```

**Verified on:** R6 Mark II, EOS R50

**Response:**
```json
{
  "kind":    "battery",     // "battery" | "ac_adapter" | "dc_coupler" | "batterygrip" | "not_inserted" | "unknown"
  "name":    "LP-E6NH",     // Battery name or "unknown"
  "level":   "quarter",     // "full" | "high" | "half" | "quarter" | "low" | "exhausted" | "charge" | "chargestop" | "chargecomp" | "none" | "unknown"
  "quality": "normal"       // "good" | "normal" | "bad" | "unknown"
}
```

Note: When AC adapter is connected (R50 with DR-E18), `kind` is `"ac_adapter"` and `level`/`quality` are empty strings.

### Battery list (preferred)

```
GET /ccapi/ver110/devicestatus/batterylist
```

**Verified on:** R6 Mark II, EOS R50

Returns numeric percentage for `level` — more precise than the named levels from `battery`. Use this when available and fall back to `battery` (ver100) if it returns non-200.

**Response:**
```json
{
  "batterylist": [
    {
      "position": "camera",
      "kind":     "battery",
      "name":     "LP-E6NH",
      "quality":  "normal",
      "level":    "14"
    }
  ]
}
```

Note: `level` is a numeric string (percentage `"0"`–`"100"`), or `""` for AC adapter.

---

### Storage status

```
GET /ccapi/ver110/devicestatus/storage
```

**Response:**
```json
{
  "storagelist": [{
    "name": "card1",
    "path": "/ccapi/ver120/contents/card1",
    "accesscapability": "readwrite",
    "maxsize": 255802212352,
    "spacesize": 224084885504,
    "contentsnumber": 1162
  }]
}
```

---

### Alternative: ver110/event/polling (simpler but requires re-polling)

```
GET /ccapi/ver110/event/polling
DELETE /ccapi/ver110/event/polling   ← reset session
```

**Behaviour:** Blocks until **any** camera event occurs (shot, settings change, etc.), then returns a single flat JSON object and closes. Must be re-issued immediately after each response to continue receiving events.

**Response on shot (same addedcontents format):**
```json
{
  "addedcontents": ["/ccapi/ver120/contents/card1/100EOSR6/4E5A8288.CR3"],
  "av": { "value": "f2.8", "ability": [...] },
  "tv": { "value": "1/125", "ability": [] },
  "recordable": { "recordableshots": 6051, "remainingtime": null }
}
```

**vs monitoring:** Both work; monitoring is preferred (persistent stream, no re-poll overhead). Polling is simpler to parse (plain JSON, no binary framing).

---

## Notes

- Camera must be on the same WiFi network as the Mac
- CCAPI must be enabled once via Canon's activation tool (USB, one-time)
- HTTPS port: **443** (default) — configurable in camera menu
- HTTP port: **8080** (if HTTPS disabled)
- The polling endpoint does **not** queue events — shots during burst may be missed; acceptable for v1
- `DELETE /ccapi/ver110/event/polling` cancels a pending poll (useful for clean disconnect)
