#!/usr/bin/env python3
"""
check-nginx-conf.py -- structural sanity check for the ATS nginx configs.

Why this exists (T-418c):
    The original T-418 CI step shelled out to `nginx -t` against a stubbed
    conf tree (apt-install nginx, stub TLS certs, sed-rewrite paths, openssl
    dhparam, heredoc nginx.conf...). That step kept failing on the GitHub
    runner for fragile reasons (openssl dhparam 256 rejected by OpenSSL 3,
    heredoc expansion timing, etc.), and the cure (inlining a Python brace
    balance check via `python3 - <<'PYEOF'`) broke YAML when '\n' inside the
    Python regex got interpreted as a real newline.

    Lesson learned: keep CI shell tiny, push logic into a real file with a
    proper shebang. This script is what T-418 was trying to do all along.

What it catches:
    -  Mismatched { } counts          (e.g. a truncated edit lost a closing brace)
    -  File doesn't end with `}`      (e.g. T-412b shipped a truncated config)
    -  `server {` without matching `}` (rough heuristic; comments stripped)

What it does NOT catch:
    -  Semicolon errors inside directives (would need a real nginx parser)
    -  Cert path validity
    -  Upstream/proxy_pass semantic correctness

That's fine -- the goal is to catch the exact failure mode that bit prod
in T-412b (truncated config that operator-side `nginx -t` rejected), not
to replace a real nginx parser.

Exit codes:
    0 = all configs look structurally OK (or skipped because absent)
    1 = at least one config failed a structural check
"""
import os
import re
import sys

CONFIGS = [
    "deploy/nginx/ats.rajasekarselvam.com.conf",
    "deploy/nginx/rajasekarselvam.com.conf",
]


def check_one(path: str) -> bool:
    """Return True on pass, False on fail. Prints status either way."""
    if not os.path.exists(path):
        print(f"  SKIP {path} (not present)")
        return True

    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read()

    # Strip `# comment` lines so braces inside comments do not skew the count.
    # Using a class-with-explicit-newline regex so this works even when the
    # source is embedded somewhere weird (which is what bit T-418b).
    stripped = re.sub(r"#[^\r\n]*", "", text)
    opens = stripped.count("{")
    closes = stripped.count("}")

    if opens != closes:
        print(f"  FAIL {path}: {opens} {{ vs {closes} }} (mismatched braces)")
        return False

    if not text.rstrip().endswith("}"):
        print(f"  FAIL {path}: file does not end with closing brace (truncated?)")
        return False

    # Rough heuristic: every `server {` should have a matching `}` somewhere
    # after it. We just count occurrences; depth check would need a real parser.
    server_blocks = len(re.findall(r"\bserver\s*\{", stripped))
    location_blocks = len(re.findall(r"\blocation\b[^{]*\{", stripped))
    print(
        f"  OK   {path}: {opens}/{closes} braces, "
        f"{server_blocks} server blocks, {location_blocks} location blocks"
    )
    return True


def main() -> int:
    fails = 0
    for fn in CONFIGS:
        if not check_one(fn):
            fails += 1

    if fails:
        print(f"!! {fails} nginx config(s) failed structural check", file=sys.stderr)
        return 1
    print("nginx config structural check OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
