"""Inline the decoder and map data into one self-contained page:
    python ui/build.py  ->  ui/dist/turnout-board.html
"""
from pathlib import Path

here = Path(__file__).resolve().parent
page = (here / "board.template.html").read_text()
page = page.replace("/*__DECODER__*/", (here / "selcall.js").read_text())
page = page.replace("/*__GEO__*/null", (here / "auckland.geo.json").read_text().strip())
(here / "dist").mkdir(exist_ok=True)
(here / "dist" / "turnout-board.html").write_text(page)
print(f"wrote dist/turnout-board.html ({len(page) // 1024} KB)")
