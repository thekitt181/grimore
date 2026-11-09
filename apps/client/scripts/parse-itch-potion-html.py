import re
from pathlib import Path

t = Path(r"C:\Users\Admin\Downloads\32x32_rpg_animated_potions_pack_v1.zip").read_text(
    encoding="utf-8", errors="replace"
)
# likely data-url or a.download_btn
for pat in [
    r'data-url="([^"]+)"',
    r'href="(https://[^"]+itch\.zone[^"]+)"',
    r'href="(/[^"]*download[^"]*)"',
    r'class="[^"]*download_btn[^"]*"[^>]*href="([^"]+)"',
    r'https://[a-z0-9.-]*itch\.zone[^"\s]+',
]:
    hits = re.findall(pat, t)
    print(pat, hits[:8])
# upload id
print("upload", re.findall(r"upload_id[^0-9]*([0-9]+)", t)[:10])
print("5247397 around")
idx = t.find("5247397")
print(t[max(0, idx - 200) : idx + 400] if idx >= 0 else "no")
