#!/usr/bin/env python3
"""T-215: catch the TDZ-violation bug class introduced by T-214.

JavaScript `const` is NOT hoisted. When server.js does:

    const { mountFoo } = require('./routes/foo');   // line 2575
    ...
    mountFoo(app);                                   // line 1770

Node throws on boot:

    ReferenceError: Cannot access 'mountFoo' before initialization
        at Object.<anonymous> (/app/server.js:1770:1)

This script enforces that any name imported via `const { ... } =
require('./routes/...')` (or `require('./services/...')`) is used
ONLY AFTER its declaration line. Failure = exit 1 + actionable error
message naming the offending name + the use site line.

Wired into .github/workflows/ci.yml as a step that runs after the JS
syntax check and before backend unit tests. Catches the T-214 bug
class at PR time so no rolled-back deploys.

Usage:
    python3 deploy/scripts/check-require-order.py [server-js-path]
    # default path: deploy/backend/server.js
"""

from __future__ import annotations
import re
import sys
from pathlib import Path


SCAN_PREFIXES = (
    "./routes/",
    "./services/",
)


def main() -> int:
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "deploy/backend/server.js")
    if not target.is_file():
        print(f"!! file not found: {target}", file=sys.stderr)
        return 2

    src = target.read_text(encoding="utf-8")
    lines = src.splitlines()

    # Find every `const { A, B, C } = require('./routes/X')` line. Capture the
    # imported names and the line number where the require sits.
    # We accept both single and double quotes, and we accept any whitespace.
    require_re = re.compile(
        r"^\s*const\s*\{\s*([^}]+?)\s*\}\s*=\s*require\(\s*['\"]"
        r"(\.\/(?:routes|services)\/[^'\"]+)"
        r"['\"]\s*\)\s*;",
        re.MULTILINE,
    )

    failures: list[str] = []
    imports: list[tuple[str, int, str]] = []   # (name, line, module)

    for m in require_re.finditer(src):
        line = src[:m.start()].count("\n") + 1
        names_chunk = m.group(1)
        module = m.group(2)
        # Split names on comma, strip whitespace, ignore destructuring
        # rename syntax `Foo: Bar` (rare in this codebase).
        for raw in names_chunk.split(","):
            name = raw.strip().split(":")[0].strip()
            if not name:
                continue
            imports.append((name, line, module))

    if not imports:
        print("(no `const { ... } = require('./routes/...')` patterns found -- nothing to check)")
        return 0

    print(f"Scanning {len(imports)} imported name(s) from {target}...")

    # For each imported name, find the FIRST use line. A "use" is the name
    # appearing as a non-declaration identifier somewhere in the source.
    # We look for word-boundary occurrences and exclude:
    #   - the require line itself (and any other `const { ... } = require(...)`
    #     line that lists the name)
    #   - lines starting with `//` or inside block comments
    #   - lines inside string literals (heuristic: skip lines whose code
    #     portion is entirely a string)
    #
    # The check is conservative -- false positives are acceptable (better to
    # flag a legitimate ordering than to miss a real TDZ violation). False
    # negatives would defeat the gate's purpose.

    def is_comment_line(line: str) -> bool:
        s = line.strip()
        return s.startswith("//") or s.startswith("*") or s.startswith("/*")

    # Map of name -> declaration line (the latest declaration line, which is
    # the binding that's actually in scope at runtime).
    decl_line = {name: ln for (name, ln, _mod) in imports}
    # If the same name is imported from multiple modules (shouldn't happen
    # but defensive), use the EARLIEST line so the latest-use check is
    # against the strictest binding.
    for (name, ln, _mod) in imports:
        if ln < decl_line[name]:
            decl_line[name] = ln

    for (name, declared_at, module) in imports:
        pattern = re.compile(r"\b" + re.escape(name) + r"\b")
        for i, raw_line in enumerate(lines, start=1):
            if i == declared_at:
                continue   # this is the require line itself
            if is_comment_line(raw_line):
                continue
            # Strip line-comment portion before grepping
            code_only = raw_line
            ci = code_only.find("//")
            if ci != -1:
                code_only = code_only[:ci]
            # Skip lines that re-declare the name (other require destructures)
            if re.match(
                r"^\s*const\s*\{[^}]*\b" + re.escape(name) + r"\b[^}]*\}\s*=\s*require",
                code_only,
            ):
                continue
            if pattern.search(code_only):
                if i < declared_at:
                    failures.append(
                        f"  '{name}' (imported from {module} at line {declared_at}) "
                        f"is USED at line {i} -- BEFORE its declaration.\n"
                        f"     Line {i}: {raw_line.strip()[:160]}"
                    )
                break  # only report the first use site

    if failures:
        print()
        print("!! require-order check FAILED:", file=sys.stderr)
        print("!! Move the `const { X } = require(...)` line to the TOP of the file (near other requires).",
              file=sys.stderr)
        print(file=sys.stderr)
        for f in failures:
            print(f, file=sys.stderr)
        print(file=sys.stderr)
        return 1

    print(f"OK -- all {len(imports)} imports are used AFTER their declaration line.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
