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

### Long-poll for new shot events

```
GET /ccapi/ver110/event/polling
```

**Behaviour:** Blocks until an event occurs (new shot, settings change, etc.).
Do not set a short timeout — use at least 60s.

**Response on new shot:**
```json
{
  "kind": "shotnotification",
  "value": {
    "path": "/ccapi/ver120/contents/card1/100EOSR6/4E5A7114.CR3"
  }
}
```

⚠️ The `value` contains a single `path` field (not separate `dirname`/`filename`).
Tethr's SSE route normalises this: splits on `/`, pops the filename, sends `{ dirname, filename }` to the frontend.

After receiving a response, immediately re-issue the request to continue receiving events.

**Error handling:**
- On network error or non-200: exponential back-off (1s → 2s → 4s … max 30s), then retry
- The SSE route handles this transparently — the frontend sees `status: reconnecting`

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

## Notes

- Camera must be on the same WiFi network as the Mac
- CCAPI must be enabled once via Canon's activation tool (USB, one-time)
- HTTPS port: **443** (default) — configurable in camera menu
- HTTP port: **8080** (if HTTPS disabled)
- The polling endpoint does **not** queue events — shots during burst may be missed; acceptable for v1
- `DELETE /ccapi/ver110/event/polling` cancels a pending poll (useful for clean disconnect)
