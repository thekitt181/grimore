"""Download Alstra Infinite Chests (FAL) for local personal use only."""
from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

PAGE = "https://alstrainfinite.itch.io/chests"
PURCHASE = "https://alstrainfinite.itch.io/chests/purchase"
DEST = Path(__file__).resolve().parents[1] / "public/props3d/alstra"

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) GrimoireVTT/1.0"


def get(url: str, data: bytes | None = None, headers: dict | None = None) -> tuple[bytes, str]:
    h = {"User-Agent": UA, **(headers or {})}
    req = urllib.request.Request(url, data=data, headers=h)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read(), r.geturl()


def main() -> None:
    html, _ = get(PAGE)
    text = html.decode("utf-8", "replace")
    csrf = re.search(r'name="csrf_token"\s+value="([^"]+)"', text)
    print("csrf", bool(csrf))
    token = csrf.group(1) if csrf else ""

    # Try download_url endpoint
    payload = urllib.parse.urlencode({"csrf_token": token}).encode()
    try:
        body, final = get(
            "https://alstrainfinite.itch.io/chests/download_url",
            data=payload,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Referer": PAGE,
                "Origin": "https://alstrainfinite.itch.io",
            },
        )
        print("download_url", final, body[:500])
    except Exception as e:
        print("download_url fail", e)

    # Purchase page (name-your-price $0)
    try:
        phtml, _ = get(PURCHASE)
        print("purchase", len(phtml), phtml[:400])
        pt = phtml.decode("utf-8", "replace")
        print("purchase csrf", "csrf_token" in pt)
        Path(r"C:\Users\Admin\AppData\Local\Temp\chests-purchase.html").write_bytes(phtml)
        for m in re.finditer(r'action="([^"]+)"', pt):
            print("form action", m.group(1)[:120])
        if "upload_id" in pt:
            print("has upload_id")
        ids = re.findall(r'data-upload_id="(\d+)"', pt)
        print("data-upload_id", ids[:20])
    except Exception as e:
        print("purchase fail", e)


if __name__ == "__main__":
    main()
