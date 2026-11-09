"""Download Sprites Chest 32x32 potions (personal End Product; do not redistribute)."""
from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

PAGE = "https://sazkuash.itch.io/potions-runes-pack-32x32-rpg-potions-runes"
DEST = Path(__file__).resolve().parents[1] / "public/props/sazkuash"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"


def get(url: str, data: bytes | None = None, headers: dict | None = None) -> tuple[bytes, str]:
    h = {"User-Agent": UA, "Accept": "*/*", "Referer": PAGE, **(headers or {})}
    req = urllib.request.Request(url, data=data, headers=h)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read(), r.geturl()


def main() -> None:
    html, _ = get(PAGE)
    text = html.decode("utf-8", "replace")
    csrf = re.search(r'name="csrf_token"\s+value="([^"]+)"', text)
    token = csrf.group(1) if csrf else ""
    uploads = re.findall(r'data-upload_id="(\d+)"', text)
    files = re.findall(r"/file/(\d+)", text)
    print("csrf", bool(token), "uploads", uploads, "files", files[:8])

    payload = urllib.parse.urlencode({"csrf_token": token}).encode()
    try:
        body, final = get(
            PAGE + "/download_url",
            data=payload,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Origin": "https://sazkuash.itch.io",
            },
        )
        print("download_url", final, body[:800])
        data = json.loads(body.decode())
        url = data.get("url")
        if url:
            hop, _ = get(url)
            html = hop.decode("utf-8", "replace")
            print("hop", len(hop), html[:120].replace("\n", " "))
            cdn = re.search(r'https://[^"\']+itch\.zone[^"\']+', html)
            if not cdn:
                cdn = re.search(r'(https://[^"\']+\.zip[^"\']*)', html)
            print("cdn", cdn.group(0) if cdn else None)
            if cdn:
                zipb, _ = get(cdn.group(0).replace("&amp;", "&"))
                out = Path.home() / "Downloads" / "32x32_rpg_animated_potions_pack_v1.zip"
                out.write_bytes(zipb)
                print("wrote", out, len(zipb), zipb[:4])
                return
            Path(r"C:\Users\Admin\AppData\Local\Temp\potion-dl.html").write_text(html, encoding="utf-8")
            return
    except Exception as e:
        print("download_url fail", e)

    # Name-your-price $0 purchase form
    try:
        phtml, _ = get(PAGE + "/purchase")
        pt = phtml.decode("utf-8", "replace")
        print("purchase", len(pt), "upload", re.findall(r'data-upload_id="(\d+)"', pt)[:8])
        Path(r"C:\Users\Admin\AppData\Local\Temp\potions-purchase.html").write_text(pt, encoding="utf-8")
    except Exception as e:
        print("purchase fail", e)


if __name__ == "__main__":
    main()
