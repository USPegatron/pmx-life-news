"""Test alternative search engines for flight status scraping."""
import os, re
import requests

ca = os.environ.get("REQUESTS_CA_BUNDLE") or r"C:\Users\Jacky2_Wang\.config\opencode\skills\pega-oa-network-proxy\scripts\cacert.pem"
q = "WN756 flight status 2026-11-17 ELP LAX"

def report(name, html):
    print(f"\n===== {name} =====")
    print("size:", len(html))
    # Try DDG-style snippet
    ddg = re.findall(r'class="result__snippet[^>]*>(.*?)</(?:a|td)>', html, re.DOTALL | re.IGNORECASE)
    print("DDG-style snippets:", len(ddg))
    # Try Bing-style snippet
    bing = re.findall(r'<p[^>]*>(.*?)</p>', html[:8000], re.DOTALL)
    bing_clean = [re.sub(r"<[^>]+>", " ", p).strip() for p in bing if 30 < len(re.sub(r"<[^>]+>", " ", p).strip()) < 400]
    print("Bing-style p tags (clean):", len(bing_clean))
    for p in bing_clean[:3]:
        print("  -", p[:200])
    # Look for status keywords
    lower = html.lower()
    for kw in ["on time", "departing on time", "delayed", "cancelled", "arrived", "landed"]:
        if kw in lower:
            print(f"  found keyword: {kw!r}")
    # Check if it looks like an error / captcha page
    if "captcha" in lower or "are you a human" in lower or "robot check" in lower:
        print("  *** CAPTCHA / BOT DETECTION ***")

# DDG Lite (no JS)
try:
    r = requests.get(
        "https://lite.duckduckgo.com/lite/",
        params={"q": q},
        headers={"User-Agent": "Mozilla/5.0"},
        timeout=30,
    )
    print("DDG Lite status:", r.status_code)
    report("DDG Lite", r.text)
except Exception as e:
    print("DDG Lite err:", e)

# Bing
try:
    r = requests.get(
        "https://www.bing.com/search",
        params={"q": q},
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"},
        timeout=30,
    )
    print("Bing status:", r.status_code)
    report("Bing", r.text)
except Exception as e:
    print("Bing err:", e)
