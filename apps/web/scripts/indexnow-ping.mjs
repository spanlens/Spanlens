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

/**
 * Confirm our own key file is live and world-readable before we ask
 * IndexNow to verify it. If this fails the fault is ours (key file
 * missing, wrong contents, deploy not live) and the job must fail loudly.
 */
async function assertKeyFileLive() {
  const keyUrl = `https://${HOST}/${KEY}.txt`
  const res = await fetch(keyUrl)
  if (!res.ok) {
    throw new Error(`key file not reachable: ${res.status} ${res.statusText} at ${keyUrl}`)
  }
  const body = (await res.text()).trim()
  if (body !== KEY) {
    throw new Error(`key file contents mismatch at ${keyUrl}: expected ${KEY}, got "${body.slice(0, 64)}"`)
  }
}

async function postPing(urlList) {
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host: HOST,
      key: KEY,
      keyLocation: `https://${HOST}/${KEY}.txt`,
      urlList,
    }),
  })
}

/**
 * Submit URLs. Return values:
 * - { ok: true, status }  submitted (200) or validation pending (202)
 * - { ok: false, softFail: true }  IndexNow could not verify ownership
 *   yet (403) even though our key file is live. This is IndexNow's own
 *   verification-cache lag, not our bug; it self-heals on a later push,
 *   so we warn and exit 0 rather than reporting a false failure.
 * Any other non-2xx (400/422 malformed payload, 429, 5xx) throws.
 */
async function ping(urlList) {
  // One retry on 403, since the lag is usually brief.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await postPing(urlList)
    if (res.status === 200 || res.status === 202) {
      return { ok: true, status: res.status }
    }
    const body = await res.text().catch(() => '')
    if (res.status === 403) {
      if (attempt === 1) {
        console.warn(`IndexNow returned 403 on attempt ${attempt}, retrying once...`)
        continue
      }
      console.warn(
        `IndexNow could not verify ownership yet (403) despite the key file being live. ` +
          `This is IndexNow verification lag, not a site problem. Skipping without failure. ${body}`,
      )
      return { ok: false, softFail: true }
    }
    throw new Error(`IndexNow ping failed: ${res.status} ${res.statusText} ${body}`)
  }
  // Unreachable: the loop returns or throws on every path.
  return { ok: false, softFail: true }
}

const urls = await fetchSitemapUrls()
await assertKeyFileLive()
const result = await ping(urls)
if (result.ok) {
  console.log(`IndexNow: submitted ${urls.length} URLs (HTTP ${result.status})`)
} else {
  console.log(`IndexNow: skipped ${urls.length} URLs (verification pending on IndexNow side)`)
}
