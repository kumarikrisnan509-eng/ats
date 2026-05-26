#!/usr/bin/env python3
"""check-nginx-conf.py -- structural sanity check for ATS nginx configs.

T-418c origin: replaces a fragile `nginx -t` CI step with a pure-Python check.
T-423c extension: snippet-file validation (bare directives must end with `;`).
"""
import os
import re
import sys

SITE_CONFIGS = [
    "deploy/nginx/ats.rajasekarselvam.com.conf",
    "deploy/nginx/rajasekarselvam.com.conf",
]

SNIPPET_CONFIGS = [
    "deploy/nginx/ats-security-headers.conf",
]


def check_site(path):
    if not os.path.exists(path):
        print("  SKIP " + path + " (not present)")
        return True
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read()
    stripped = re.sub(r"#[^\r\n]*", "", text)
    opens = stripped.count("{")
    closes = stripped.count("}")
    if opens != closes:
        print("  FAIL " + path + ": " + str(opens) + " { vs " + str(closes) + " } (mismatched braces)")
        return False
    if not text.rstrip().endswith("}"):
        print("  FAIL " + path + ": file does not end with closing brace (truncated?)")
        return False
    server_blocks = len(re.findall(r"\bserver\s*\{", stripped))
    location_blocks = len(re.findall(r"\blocation\b[^{]*\{", stripped))
    print("  OK   " + path + ": " + str(opens) + "/" + str(closes) + " braces, " + str(server_blocks) + " server blocks, " + str(location_blocks) + " location blocks")
    return True


def check_snippet(path):
    """T-423c: catches the truncated-mid-directive failure that bit prod."""
    if not os.path.exists(path):
        print("  SKIP " + path + " (not present)")
        return True
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read()
    if not text.endswith("\n"):
        print("  FAIL " + path + ": file does not end with newline (truncated?)")
        return False
    bad_lines = []
    for i, line in enumerate(text.split("\n"), start=1):
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        if s in ("{", "}"):
            continue
        if not (s.endswith(";") or s.endswith("{") or s.endswith("}")):
            bad_lines.append((i, s[:80]))
    if bad_lines:
        for lineno, content_preview in bad_lines:
            print("  FAIL " + path + ":" + str(lineno) + ": missing terminator -- " + repr(content_preview))
        return False
    n = sum(1 for line in text.split("\n") if line.strip() and not line.strip().startswith("#") and line.strip().endswith(";"))
    print("  OK   " + path + ": " + str(n) + " directives, all properly terminated")
    return True


def main():
    fails = 0
    for fn in SITE_CONFIGS:
        if not check_site(fn):
            fails += 1
    for fn in SNIPPET_CONFIGS:
        if not check_snippet(fn):
            fails += 1
    if fails:
        sys.stderr.write("!! " + str(fails) + " nginx config(s) failed structural check\n")
        return 1
    print("nginx config structural check OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
