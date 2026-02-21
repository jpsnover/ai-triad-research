#!/usr/bin/env python3
"""
ingest.py — AI Triad document ingestion script.

Usage:
    python scripts/ingest.py --url https://example.com/article --pov accelerationist skeptic
    python scripts/ingest.py --url https://example.com/article --pov safetyist --topics alignment governance
    python scripts/ingest.py --inbox                   # process all files in sources/_inbox/
    python scripts/ingest.py --file path/to/file.pdf --pov skeptic

What this script does:
    1. Generates a stable doc-id slug from the title/URL.
    2. Creates sources/<doc-id>/raw/ and saves the original file.
    3. Converts to Markdown snapshot (sources/<doc-id>/snapshot.md).
    4. Creates sources/<doc-id>/metadata.json with summary_status: pending.
    5. Optionally triggers Wayback Machine save (fire-and-forget).
    6. Prints the doc-id for use in follow-up commands.

TODO: Implement using libraries such as:
    - requests / httpx          for URL fetching
    - markdownify / trafilatura for HTML-to-Markdown
    - pypdf / pdfminer          for PDF text extraction
    - python-slugify             for doc-id generation
    - waybackpy                  for Wayback Machine submission
"""

import argparse
import json
import os
import re
import sys
from datetime import date, datetime
from pathlib import Path

REPO_ROOT   = Path(__file__).parent.parent
SOURCES_DIR = REPO_ROOT / "sources"
INBOX_DIR   = SOURCES_DIR / "_inbox"
VALID_POVS  = {"accelerationist", "safetyist", "skeptic", "cross-cutting"}


def make_slug(text: str, max_len: int = 60) -> str:
    slug = re.sub(r"[^\w\s-]", "", text.lower())
    slug = re.sub(r"[\s_]+", "-", slug).strip("-")
    return slug[:max_len]


def create_metadata(doc_id, title, url, authors, source_type, pov_tags, topic_tags):
    return {
        "id": doc_id,
        "title": title,
        "url": url,
        "authors": authors,
        "date_published": None,
        "date_ingested": date.today().isoformat(),
        "source_type": source_type,
        "pov_tags": pov_tags,
        "topic_tags": topic_tags,
        "rolodex_author_ids": [],
        "archive_status": "pending",
        "summary_version": None,
        "summary_status": "pending"
    }


def main():
    parser = argparse.ArgumentParser(description="Ingest a document into the AI Triad repository.")
    parser.add_argument("--url",    help="URL of web article to ingest")
    parser.add_argument("--file",   help="Path to local PDF/DOCX/HTML file")
    parser.add_argument("--inbox",  action="store_true", help="Process all files in sources/_inbox/")
    parser.add_argument("--pov",    nargs="+", choices=sorted(VALID_POVS), default=[], help="POV tag(s)")
    parser.add_argument("--topics", nargs="+", default=[], help="Topic tags")
    args = parser.parse_args()

    if not any([args.url, args.file, args.inbox]):
        parser.error("Specify --url, --file, or --inbox.")

    # TODO: implement fetch, convert, and write logic
    print("TODO: ingest.py not yet implemented. Stub created by Initialize-AITriadRepo.ps1")
    sys.exit(0)


if __name__ == "__main__":
    main()
