"""Debug: see what DuckDuckGo HTML returns for our query."""
import os, re
import requests

ca = os.environ.get("REQUESTS_CA_BUNDLE") or r"C:\Users\Jacky2_Wang\.config\opencode\skills\pega-oa-network-proxy\scripts\cacert.pem"

r = requests.post(
    "https://html.duckduckgo.com/html/",
    data={"q": "WN756 flight status 2026-11-17 ELP LAX"},
    headers={"User-Agent": "Mozilla/5.0"},
    timeout=30,
)
print("status:", r.status_code)
print("size :", len(r.text))
print("---")
snippets = re.findall(r'class="result__snippet[^>]*>(.*?)</(?:a|td)>', r.text, re.DOTALL | re.IGNORECASE)
print("snippet matches:", len(snippets))
for i, s in enumerate(snippets[:5]):
    cleaned = re.sub(r"<[^>]+>", " ", s)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    print(f"[{i}] {cleaned[:250]}")
print("---")
results = re.findall(r'class="result[^"\s>]+', r.text)
print("unique result classes:", sorted(set(results))[:20])
print("---")
print("URLs found:")
urls = re.findall(r'class="result__url"[^>]*href="([^"]+)"[^>]*>([^<]+)', r.text)
for href, txt in urls[:5]:
    print(f"  - {txt.strip()[:80]}  ->  {href[:100]}")
