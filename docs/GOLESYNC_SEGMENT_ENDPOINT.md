# Segment endpoint contract (HD engine over the LAN)

The RaGo Lens app can send a photo to a larger segmentation model running on your laptop (your GoleSync agent) and use the
mask it returns. This file is the contract for the **agent side**; nothing in the GoleSync repository was changed.

* **Disabled by default.** Turn it on in Settings > HD engine. It is the only feature that uses the network.
* **LAN only.** The app refuses any address that is not on the local network: private IPv4 (`10.x`, `172.16-31.x`, `192.168.x`),
  link-local `169.254.x`, loopback, `localhost`, or a `*.local` name. Public hosts and public IPs are rejected before a request is made.
* **Any failure falls back to the on-device model**: unreachable, timeout, bad token, busy, malformed answer. The user is not
  shown an error; the result simply records which engine made the mask.
* Plain `http://` is allowed on the LAN (the app's manifest permits cleartext traffic for this reason; see DECISIONS.md). A
  self-signed `https://` certificate will **not** work (the app does not add trust anchors); use plain http on a trusted network.

## Authentication

Every request carries `Authorization: Bearer <token>`. The token is a string you choose; it is typed into the app and stored on
the phone only. A missing or wrong token must answer `401`.

## `GET /v1/health`

Used by the "Test connection" button.

```
200 OK
Content-Type: application/json

{ "ok": true, "model": "birefnet-hr-2024", "maxEdge": 2048 }
```

`model` is shown to the user. `maxEdge` (optional) is informational.

## `POST /v1/segment`

Request

```
POST /v1/segment
Authorization: Bearer <token>
Content-Type: image/jpeg
Accept: image/png
X-Image-Width: 2048        (pixels of the JPEG that is sent, informational)
X-Image-Height: 1536

<raw JPEG bytes>
```

* Body: the working copy of the photo, upright (EXIF already applied), JPEG, long edge up to the app's "working size" setting
  (default 2048 px, at most 4096). Size limit **12 MB**; larger bodies are never sent.
* The agent should reply `413` if it wants a smaller photo.

Response (success)

```
200 OK
Content-Type: image/png

<PNG, 8-bit greyscale or grey+alpha; 255 = product, 0 = not product, soft edges welcome>
```

* The mask's aspect ratio must equal the request's (within 3 %). Its size may be smaller or larger than the request; the app
  resamples it to the photo's full resolution and then refines the edge against the real pixels.
* If the PNG has an alpha channel that is not fully opaque and the colour channels are all equal, the app reads **alpha** as the
  mask; otherwise the grey (red channel) value is the mask.

Errors (a JSON body is optional and ignored by the app, but useful for logs)

| Status | Meaning | App behaviour |
|---|---|---|
| 401 / 403 | wrong or missing token | falls back (Settings > Test connection says why) |
| 413 | photo too large | falls back |
| 429 / 503 | busy, try later | falls back |
| any other non-2xx | server error | falls back |

```
{ "error": { "code": "busy", "message": "model is loading" } }
```

## Timeouts and limits

* The app allows **30 s** for the whole request. Slower answers are abandoned and the on-device engine is used.
* Upload limit 12 MB. One request at a time per photo; in batch mode the app sends one photo after another.

## Minimal reference implementation (Python, for testing the app)

```python
# pip install fastapi uvicorn pillow
from fastapi import FastAPI, Request, Response, Header, HTTPException
from PIL import Image, ImageDraw
import io
app = FastAPI()
TOKEN = "change-me"

def auth(h):
    if h != f"Bearer {TOKEN}":
        raise HTTPException(401)

@app.get("/v1/health")
def health(authorization: str = Header(None)):
    auth(authorization)
    return {"ok": True, "model": "demo-ellipse"}

@app.post("/v1/segment")
async def segment(req: Request, authorization: str = Header(None)):
    auth(authorization)
    img = Image.open(io.BytesIO(await req.body()))
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).ellipse([img.width*0.15, img.height*0.15, img.width*0.85, img.height*0.85], fill=255)
    out = io.BytesIO(); mask.save(out, "PNG")
    return Response(out.getvalue(), media_type="image/png")
```

Run with `uvicorn server:app --host 0.0.0.0 --port 8787`, then enter `http://<laptop-ip>:8787` and the token in the app.
(The reference above has not been run against the app; it only documents the shape of the contract.)
