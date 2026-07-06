/**
 * IndexNow ping — submits every URL from the live sitemap to the IndexNow
 * API so Bing / Naver / Yandex / Seznam pick up content changes within
 * minutes instead of waiting for their crawl cycle. Google does not use
 * IndexNow; it discovers via sitemap.xml as before.
 *
 * The key is public by design (the protocol verifies ownership by fetching
 * https://<host>/<key>.txt, which must be world-readable), so it is safe to
 * commit both the key file in public/ and the constant below.
 *
 * Run manually:  node apps/web/scripts/indexnow-ping.mjs
 * CI:            .github/workflows/indexnow.yml pings on every push to main
 *                that touches apps/web/**.
 */

const HOST = 'www.spanlens.io'
const KEY = 'b15c20f4975a1540622713bffea2a6d0'
const SITEMAP_URL = `https://${HOST}/sitemap.xml`
const ENDPOINT = 'https://api.indexnow.org/indexnow'

async function fetchSitemapUrls() {
  const res = await fetch(SITEMAP_URL)
  if (!res.ok) {
    throw new Error(`sitemap fetch failed: ${res.status} ${res.statusText}`)
  }
  const xml = await res.text()
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim())
  if (urls.length === 0) {
    throw new Error('sitemap parsed to zero URLs — refusing to ping')
  }
  return urls
}

async function ping(urlList) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host: HOST,
      key: KEY,
      keyLocation: `https://${HOST}/${KEY}.txt`,
      urlList,
    }),
  })
  // 200 = submitted, 202 = key validation pending — both are success.
  if (res.status !== 200 && res.status !== 202) {
    const body = await res.text().catch(() => '')
    throw new Error(`IndexNow ping failed: ${res.status} ${res.statusText} ${body}`)
  }
  return res.status
}

const urls = await fetchSitemapUrls()
const status = await ping(urls)
console.log(`IndexNow: submitted ${urls.length} URLs (HTTP ${status})`)
