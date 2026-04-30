# CCAPI Endpoint Reference

> Read this when implementing or debugging SvelteKit API routes that talk to the camera.
> All calls are made server-side only (SvelteKit `+server.ts` routes).
> Base URL: `http://{CAMERA_IP}:8080`

---

## Authentication

CCAPI on the R6 Mark II supports optional user authentication. For local WiFi use, authentication is typically disabled. If enabled, use HTTP Basic Auth on every request.

---

## Endpoints

### List photos on card

```
GET /ccapi/ver100/contents/storage1/card1
```

**Response:**
```json
{
  "path": [
    "/ccapi/ver100/contents/storage1/card1/100CANON",
    "/ccapi/ver100/contents/storage1/card1/101CANON"
  ]
}
```

Each path is a directory (shooting session folder). Drill into a folder:

```
GET /ccapi/ver100/contents/storage1/card1/100CANON
```

```json
{
  "path": [
    "/ccapi/ver100/contents/storage1/card1/100CANON/IMG_0001.JPG",
    "/ccapi/ver100/contents/storage1/card1/100CANON/IMG_0002.JPG"
  ]
}
```

---

### Fetch thumbnail

```
GET /ccapi/ver100/contents/storage1/card1/100CANON/IMG_0001.JPG?kind=thumbnail
```

**Response:** JPEG bytes (`Content-Type: image/jpeg`)

Small, fast. Use this for the initial photo card display.

---

### Fetch full-resolution original

```
GET /ccapi/ver100/contents/storage1/card1/100CANON/IMG_0001.JPG?kind=original
```

**Response:** JPEG (or RAW) bytes

Large. Fetch lazily, newest photo first.

---

### Long-poll for new shot events

```
GET /ccapi/ver100/event/polling
```

**Behaviour:** This request **blocks** on the camera until an event occurs (new shot, setting change, etc.). The camera holds the connection open — do not set a short timeout.

**Response on new shot:**
```json
{
  "kind": "shotnotification",
  "value": {
    "storagegen": "storage1",
    "dirname": "/ccapi/ver100/contents/storage1/card1/100CANON",
    "filename": "IMG_0042.JPG"
  }
}
```

**Response on other events** (settings changes etc.):
```json
{
  "kind": "camerasettings",
  "value": { ... }
}
```

After receiving any response, immediately issue the next `GET /event/polling` to continue receiving events. The SvelteKit `/api/events` SSE route runs this loop server-side.

**Error handling:**
- On network error or non-200 status: wait with exponential back-off (1s, 2s, 4s, max 30s) then retry
- Log errors but do not crash the loop

---

### Camera status / settings (optional, for future use)

```
GET /ccapi/ver100/devicestatus/currentsetting
```

Returns current exposure settings (aperture, shutter speed, ISO, etc.). Not used in v1 but useful for the status bar.

---

## Notes

- The camera must be on the same WiFi network as the Mac
- CCAPI must be enabled in the camera menu (one-time activation via Canon's desktop tool)
- Default port is `8080`; configurable in camera menu
- CORS headers are present in CCAPI responses — but all our calls are server-side so this is irrelevant
- The polling endpoint does **not** queue events — if you are slow to re-poll, you may miss shots during burst shooting; this is acceptable for v1
