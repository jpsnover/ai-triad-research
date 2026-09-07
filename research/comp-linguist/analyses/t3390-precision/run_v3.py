import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import remeasure as rm  # safe: __main__-guarded; top-level loads data + configures genai, no LLM calls
HERE = os.path.dirname(os.path.abspath(__file__))
v3 = rm.run_variant(open(os.path.join(HERE, "logical-form-formalization.v3.prompt"), encoding="utf-8").read())
rm.score(v3, "v3 (balanced: targeted exclusions + recall-preserving)")
