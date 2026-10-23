"""Build the Auckland coastline used by the web map.

    pip install basemap basemap-data-hires shapely
    python tools/make_geo.py  ->  web/src/data/geo.json

Coastline: GSHHS full resolution (via basemap-data-hires), clipped to the
Auckland region and projected to a flat x/y space (equirectangular,
longitude scaled by cos(latitude)). The web app projects station lat/lon
with the same constants.
"""

import json
from pathlib import Path

import shapely
from mpl_toolkits.basemap import Basemap
from shapely.geometry import Polygon
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
LON0, LAT0, LON1, LAT1 = 174.30, -37.12, 175.02, -36.54
K = 0.8          # cos(-36.85 deg)
WIDTH = 2000.0   # projected units across the region
SIMPLIFY = 0.00022


def main():
    scale = WIDTH / ((LON1 - LON0) * K)
    height = round((LAT1 - LAT0) * scale)
    m = Basemap(llcrnrlon=LON0 - 0.05, llcrnrlat=LAT0 - 0.05, urcrnrlon=LON1 + 0.05,
                urcrnrlat=LAT1 + 0.05, resolution="f", projection="cyl")
    land = unary_union([Polygon(list(zip(*p))).buffer(0)
                        for p, t in zip(m.coastpolygons, m.coastpolygontypes) if t in (1, 3)])
    view = shapely.clip_by_rect(land, LON0 - 0.02, LAT0 - 0.02, LON1 + 0.02, LAT1 + 0.02)
    parts = []
    for poly in getattr(view, "geoms", [view]):
        if poly.geom_type != "Polygon" or poly.area < 1.5e-7:
            continue
        poly = poly.simplify(SIMPLIFY)
        for ring in [poly.exterior, *poly.interiors]:
            pts = [((x - LON0) * K * scale, (LAT1 - y) * scale) for x, y in ring.coords]
            parts.append("M" + "L".join(f"{x:.0f} {y:.0f}" for x, y in pts) + "Z")
    out = ROOT / "web/src/data/geo.json"
    out.write_text(json.dumps({"lon0": LON0, "lat1": LAT1, "k": K, "scale": round(scale, 4),
                               "width": WIDTH, "height": height, "land": "".join(parts),
                               "source": "GSHHS full resolution"}, separators=(",", ":")))
    print(f"{out.relative_to(ROOT)}: {out.stat().st_size // 1024} KB, {len(parts)} rings")


if __name__ == "__main__":
    main()
