"""One month of English Wikipedia page views, from Wikimedia's monthly dump, as enwiki-YYYYMM.tsv.gz.

The dump (pageviews-YYYYMM-user.bz2, about 5.7 GB) lists every wiki's pages, sorted by wiki, one line
per page and access method: "en.wikipedia Title page_id desktop 123 <daily counts>". This streams it,
adds up each English Wikipedia title's views over desktop, mobile web and app, and stops as soon as the
English Wikipedia block ends, so the rest of the file is never downloaded. Output lines: "Title<TAB>views".

dumps.wikimedia.org resets connections from an address that opens several: run one month at a time.

Run: python3 pageviews_month.py 202610 [--out DIR] [--url URL]
"""
import argparse, os, shutil, subprocess, sys, time

AWK = r"""
$1 == "en.wikipedia" {
  if ($2 != t) { if (t != "") print t "\t" s; t = $2; s = 0 }
  s += $5; seen = 1; next
}
seen && $1 > "en.wikipedia" { done = 1; exit }
END { if (t != "") print t "\t" s; if (done) print "COMPLETE" > "/dev/stderr" }
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("month", help="YYYYMM")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "pageviews"))
    ap.add_argument("--url")
    a = ap.parse_args()
    y, m = a.month[:4], a.month[4:]
    url = a.url or f"https://dumps.wikimedia.org/other/pageview_complete/monthly/{y}/{y}-{m}/pageviews-{a.month}-user.bz2"
    os.makedirs(a.out, exist_ok=True)
    out = os.path.join(a.out, f"enwiki-{a.month}.tsv.gz")
    part = out + ".part"
    unbz = "lbzip2 -dc" if shutil.which("lbzip2") else "bzcat"
    t = time.time()
    # Not pipefail: awk exiting early ends curl and the decompressor with SIGPIPE, which is the point.
    proc = subprocess.run(
        f"curl -sSfL --retry 3 -A 'waythread-spots/0.1 (https://github.com/fanzhangg/waythread)' '{url}' "
        f"| {unbz} | LC_ALL=C awk '{AWK}' | gzip -6 > '{part}'",
        shell=True, executable="/bin/bash", capture_output=True, text=True)
    if "COMPLETE" not in proc.stderr:
        sys.exit(f"{a.month}: the English Wikipedia block didn't end; the download probably broke off.\n{proc.stderr[-2000:]}")
    os.replace(part, out)
    print(f"{a.month}: {out}, {os.path.getsize(out) / 1e6:.0f} MB in {time.time() - t:.0f} s")


if __name__ == "__main__":
    main()
