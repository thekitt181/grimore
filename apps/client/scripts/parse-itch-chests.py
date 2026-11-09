from pathlib import Path
import re

h = Path(r"C:\Users\Admin\AppData\Local\Temp\chests-itch.html").read_text(
    encoding="utf-8", errors="replace"
)
for pat in ["upload_id", "data-upload_id", "csrf_token", "game_id"]:
    print(pat, len(re.findall(pat, h)))
print("numeric ids", sorted(set(re.findall(r"upload[^0-9]{0,24}(\d{5,})", h)))[:40])
i = h.find("upload_list")
print(h[i : i + 500])
print("--- csrf ---")
for m in re.finditer(r"csrf.{0,40}", h):
    print(m.group(0)[:80])
    break
print("--- view_game json ---")
j = h.find("generate_download_url")
print(h[j - 200 : j + 400] if j >= 0 else "none")
