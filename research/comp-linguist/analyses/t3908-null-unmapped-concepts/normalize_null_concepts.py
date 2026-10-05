#!/usr/bin/env python3
"""t/3908: remove bare-null elements from summaries' unmapped_concepts[] (97 files).

Census on data bc1d4d65 (861 summaries): 563 concepts-only, 201 `[]`, 96 `[null]`, 1 mixed
(`when-ai-builds-itself-2026`: one null + 5 real concepts, none resolved). The corpus convention for
"no unmapped concepts" is `[]` (201 files; 0 files omit the key), so:
  - `[null]` -> `[]`
  - mixed    -> the same list with the null element dropped (real concepts and their order kept)
Writer of the nulls: Merge-ChunkSummaries.ps1 (+ a single-call gap), fixed in t/3907. This write
waits for that fix (`/data-mutation` B: clean the source, or the files re-dirty).

Default DRY-RUN: re-derives nothing (reads frozen-files.json), re-validates each file's shape against
the frozen class, proves serializer byte-identity, 0-collateral (only unmapped_concepts changes, and
only by losing its null elements), and that the corpus-wide count of null elements in these files
goes to 0. --apply refuses while the frozen authorization is PENDING or the writer fix is unconfirmed.
"""
import json, os, sys, copy
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = r"C:/Users/jsnov/repos/ai-triad-data/.worktrees/t3908"
FROZEN = os.path.join(HERE, "frozen-files.json")
APPLY = "--apply" in sys.argv

def fail(m): print("ABORT:", m); sys.exit(1)

fz = json.load(open(FROZEN, encoding="utf-8"))
if APPLY:
    if str(fz.get("authorization", "")).upper().startswith("PENDING"):
        fail("frozen-files.json authorization is PENDING; record PI authorization on t/3908 and in the file first.")
    if not str(fz.get("writer_fix", "")).lower().startswith("merged"):
        fail("frozen-files.json writer_fix is not 'merged ...'; t/3907's writer fix must land first (or the files re-dirty).")
files = fz["files"]

def ser(o, trail): return json.dumps(o, indent=2, ensure_ascii=False) + trail

writes, n_null_removed, classes = {}, 0, {"null_only": 0, "mixed": 0}
for f in files:
    name, cls = f["file"], f["class"]
    path = os.path.join(DATA, "summaries", name)
    raw = open(path, encoding="utf-8", newline="").read()
    if "\r\n" in raw: fail(f"{name}: CRLF file; the serializer proof assumed LF")
    trail = raw[len(raw.rstrip("\n")):]
    orig = json.loads(raw)
    if ser(orig, trail) != raw: fail(f"{name}: serializer not byte-identical")
    uc = orig.get("unmapped_concepts")
    if not isinstance(uc, list) or not any(c is None for c in uc): fail(f"{name}: no null element in unmapped_concepts (state changed since freeze?)")
    kept = [c for c in uc if c is not None]
    if cls == "null_only" and kept: fail(f"{name}: frozen as null_only but has {len(kept)} real concepts")
    if cls == "mixed" and len(kept) != f["kept_concepts"]: fail(f"{name}: expected {f['kept_concepts']} kept concepts, found {len(kept)}")
    new = copy.deepcopy(orig); new["unmapped_concepts"] = kept
    # 0-collateral: everything except unmapped_concepts is deep-equal; unmapped_concepts == orig minus nulls, order kept
    a = {k: v for k, v in orig.items() if k != "unmapped_concepts"}
    b = {k: v for k, v in new.items() if k != "unmapped_concepts"}
    if a != b: fail(f"{name}: a field other than unmapped_concepts changed")
    if new["unmapped_concepts"] != [c for c in orig["unmapped_concepts"] if c is not None]: fail(f"{name}: concepts altered beyond null removal")
    if list(new.keys()) != list(orig.keys()): fail(f"{name}: key order changed")
    n_null_removed += sum(c is None for c in uc); classes[cls] += 1
    writes[path] = ser(new, trail)

print(f"[OK] {len(writes)} files ({classes['null_only']} [null] -> [], {classes['mixed']} mixed -> null dropped); "
      f"{n_null_removed} null elements removed; serializer byte-identical; 0-collateral")
if len(writes) != fz["expected_files"] or n_null_removed != fz["expected_nulls"]:
    fail(f"expected {fz['expected_files']} files / {fz['expected_nulls']} nulls")
if not APPLY:
    print("\nDRY RUN: all asserts passed, no write."); sys.exit(0)
for path, text in writes.items():
    open(path, "w", encoding="utf-8", newline="").write(text)
left = sum(1 for path in writes if any(c is None for c in json.load(open(path, encoding="utf-8"))["unmapped_concepts"]))
if left: fail(f"post-write: {left} files still contain a null element")
print(f"\n[APPLIED] {len(writes)} summaries rewritten; post-write: 0 null elements remain in them.")
