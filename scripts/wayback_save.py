#!/usr/bin/env python3
"""
wayback_save.py — Submit a URL to the Wayback Machine (Internet Archive).

Fire-and-forget: failures are logged but do not block ingestion.

Usage:
    python scripts/wayback_save.py --url https://example.com/article

TODO: Implement using the waybackpy library or direct requests to
      https://web.archive.org/save/<url>
"""

import argparse, sys

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    args = parser.parse_args()
    print(f"TODO: wayback_save.py not yet implemented for {args.url}")
    sys.exit(0)

if __name__ == "__main__":
    main()
