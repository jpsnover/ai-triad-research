"""Pre-fetch the embedding models into the HF cache (t/1989).

Kept as a SEPARATE step from the value-stability assertion so a failure here is
unambiguously an HF/network outage (infrastructure), while a failure in the
offline assertion step is a real dependency incompatibility. Never conflate them.
"""
from huggingface_hub import snapshot_download

snapshot_download("sentence-transformers/all-MiniLM-L6-v2")
snapshot_download("cross-encoder/nli-deberta-v3-small")
print("models fetched to cache")
