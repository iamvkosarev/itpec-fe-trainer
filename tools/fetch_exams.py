#!/usr/bin/env python3
"""Downloads ITPEC FE past-exam archives from itpec.org and unpacks them.

Files published at https://itpec.org/pastexamqa/fe.html are free to use for
educational purposes, which is what this project is.
"""
import os
import re
import ssl
import sys
import zipfile
import urllib.request

BASE = "https://itpec.org/pastexamqa/"
INDEX = BASE + "fe.html"
RAW_DIR = os.path.join(os.path.dirname(__file__), "..", "raw")

# Only exams from 2015 onwards: older terminology has drifted too far to be
# worth practising against.
MIN_YEAR = 2015


def archive_year(name):
    """Extracts the exam year from the wildly inconsistent archive names."""
    m = re.search(r"(20\d\d)", name)
    return int(m.group(1)) if m else 0


def list_archives():
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(INDEX, context=ctx, timeout=60) as r:
        html = r.read().decode("utf-8", "replace")
    hrefs = sorted(set(re.findall(r'href="(fe/[^"]+\.zip)"', html)))
    return [h for h in hrefs if archive_year(h) >= MIN_YEAR]


def main():
    os.makedirs(RAW_DIR, exist_ok=True)
    archives = list_archives()
    print("%d archives from %d onwards" % (len(archives), MIN_YEAR))
    for href in archives:
        name = os.path.basename(href)
        zip_path = os.path.join(RAW_DIR, name)
        if not os.path.exists(zip_path):
            url = BASE + href
            sys.stdout.write("  downloading %s ... " % name)
            sys.stdout.flush()
            try:
                urllib.request.urlopen(url, timeout=120)
            except Exception as e:
                print("FAILED (%s)" % e)
                continue
            urllib.request.urlretrieve(url, zip_path)
            print("%d KB" % (os.path.getsize(zip_path) // 1024))
        out_dir = os.path.join(RAW_DIR, os.path.splitext(name)[0])
        if not os.path.isdir(out_dir):
            with zipfile.ZipFile(zip_path) as z:
                z.extractall(out_dir)
    print("done -> %s" % os.path.abspath(RAW_DIR))


if __name__ == "__main__":
    main()
