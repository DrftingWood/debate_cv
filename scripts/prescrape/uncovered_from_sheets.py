"""List Calicotab tournaments that a spreadsheet's "Tabs" tab links but no stage list covers.

How stages B-E were built (docs/runbooks/B9-prescrape-load.md): export the
Official Global Debating Spreadsheet as .xlsx, read the hyperlink on every
cell of each "Tabs" tab, normalise to host + first path segment, drop what
the existing stage lists already hold, then bucket the rest by the year in
the slug or the tournament name.

    python scripts/prescrape/uncovered_from_sheets.py sheet1.xlsx [sheet2.xlsx ...]

Prints one bucket per line (2020-2025 / 2026+ / pre-2020 / undated) and writes
nothing; redirect the URLs you want into a new stage file. Needs openpyxl.
A link whose path is "/_/" (a result page, not a tournament slug) becomes the
host root, which the pre-scrape runner expands into every tournament linked.
"""
import glob
import os
import re
import sys
from collections import defaultdict
from urllib.parse import urlparse

import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))


def key_of(url):
    p = urlparse(url.strip().replace("http://", "https://"))
    segs = [s for s in p.path.split("/") if s]
    slug = segs[0] if segs and segs[0] != "_" else ""
    return p.netloc.lower(), slug.lower(), slug


def covered_keys():
    keys, hosts = set(), set()
    for path in glob.glob(os.path.join(HERE, "stage-*.txt")):
        for line in open(path, encoding="utf8"):
            line = line.strip()
            if line.startswith("http"):
                host, slug, _ = key_of(line)
                keys.add((host, slug))
                hosts.add(host)
    return keys, hosts


def years_in(text, slug, host):
    ys = {int(y) for y in re.findall(r"(?<![0-9])(20[0-2][0-9])(?![0-9])", text)}
    # two-digit suffixes such as westerniv26 or dmd22
    ys |= {int(y) + 2000 for y in re.findall(r"(?<![0-9])(1[0-9]|2[0-6])(?![0-9a-z])", slug or host.split(".")[0])}
    return ys


def main(paths):
    keys, hosts = covered_keys()
    found = {}
    for path in paths:
        wb = openpyxl.load_workbook(path)
        for ws in wb:
            if not ws.title.strip().lower().startswith("tabs"):
                continue
            for row in ws.iter_rows():
                for cell in row:
                    link = cell.hyperlink.target if cell.hyperlink and cell.hyperlink.target else None
                    if not link or "calicotab.com" not in link:
                        continue
                    host, slug_l, slug = key_of(link)
                    left = [ws.cell(row=cell.row, column=k).value for k in range(cell.column - 1, 0, -1)]
                    name = next((str(v) for v in left if v and not str(v).startswith("http")), "")
                    entry = found.setdefault((host, slug_l), {"years": set(), "url": f"https://{host}/{slug + '/' if slug else ''}"})
                    entry["years"] |= years_in(name + " " + link, slug, host)
    buckets = defaultdict(list)
    for (host, slug_l), e in found.items():
        # covered: same host + slug, a root entry on a covered host, or a slugged entry whose root is covered
        if (host, slug_l) in keys or (slug_l == "" and host in hosts) or (slug_l and (host, "") in keys):
            continue
        ys = e["years"]
        b = "undated" if not ys else "2026+" if max(ys) >= 2026 else "pre-2020" if max(ys) < 2020 else "2020-2025"
        buckets[b].append(e["url"])
    for b in ("2020-2025", "2026+", "pre-2020", "undated"):
        print(f"# {b}: {len(buckets[b])}")
        for u in sorted(buckets[b]):
            print(u)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
