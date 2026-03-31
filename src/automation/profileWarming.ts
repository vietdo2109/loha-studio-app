/**
 * Profile Warming — build realistic browsing history, cookies, and GA fingerprints
 * for Veo3 Chrome profiles so they pass reCAPTCHA Enterprise scoring.
 *
 * Two main features:
 *   1. warmProfile()      — first-time / daily warm: visit 15-20 GA sites, build cookies
 *   2. simulateHumanTab() — during video creation: open a random search tab (real-user noise)
 */

import { BrowserContext, Page } from 'patchright'

// ─── Popular sites with Google Analytics ────────────────────────────────────────
const GA_SITES: { url: string; label: string }[] = [
  { url: 'https://www.youtube.com', label: 'YouTube' },
  { url: 'https://www.google.com/search?q=best+video+editing+tips', label: 'Google Search' },
  { url: 'https://www.reddit.com', label: 'Reddit' },
  { url: 'https://www.wikipedia.org', label: 'Wikipedia' },
  { url: 'https://www.amazon.com', label: 'Amazon' },
  { url: 'https://github.com/trending', label: 'GitHub' },
  { url: 'https://stackoverflow.com', label: 'StackOverflow' },
  { url: 'https://medium.com', label: 'Medium' },
  { url: 'https://www.linkedin.com', label: 'LinkedIn' },
  { url: 'https://www.quora.com', label: 'Quora' },
  { url: 'https://www.cnn.com', label: 'CNN' },
  { url: 'https://www.bbc.com', label: 'BBC' },
  { url: 'https://weather.com', label: 'Weather.com' },
  { url: 'https://www.imdb.com', label: 'IMDb' },
  { url: 'https://www.pinterest.com', label: 'Pinterest' },
  { url: 'https://www.espn.com', label: 'ESPN' },
  { url: 'https://www.nytimes.com', label: 'NYTimes' },
  { url: 'https://www.twitch.tv', label: 'Twitch' },
  { url: 'https://news.ycombinator.com', label: 'Hacker News' },
  { url: 'https://www.google.com/maps', label: 'Google Maps' },
  { url: 'https://mail.google.com', label: 'Gmail' },
  { url: 'https://drive.google.com', label: 'Google Drive' },
  { url: 'https://docs.google.com', label: 'Google Docs' },
  { url: 'https://www.google.com/search?q=weather+today', label: 'Google Weather' },
  { url: 'https://www.google.com/search?q=latest+technology+news', label: 'Google Tech search' },
  { url: 'https://www.booking.com', label: 'Booking.com' },
  { url: 'https://www.tripadvisor.com', label: 'Tripadvisor' },
  { url: 'https://www.airbnb.com', label: 'Airbnb' },
  { url: 'https://www.ebay.com', label: 'eBay' },
  { url: 'https://www.etsy.com', label: 'Etsy' },
  { url: 'https://www.target.com', label: 'Target' },
  { url: 'https://www.walmart.com', label: 'Walmart' },
  { url: 'https://www.bestbuy.com', label: 'Best Buy' },
  { url: 'https://www.apple.com', label: 'Apple' },
  { url: 'https://www.microsoft.com', label: 'Microsoft' },
  { url: 'https://open.spotify.com', label: 'Spotify' },
  { url: 'https://www.dropbox.com', label: 'Dropbox' },
  { url: 'https://zoom.us', label: 'Zoom' },
  { url: 'https://www.indeed.com', label: 'Indeed' },
  { url: 'https://www.coursera.org', label: 'Coursera' },
  { url: 'https://www.khanacademy.org', label: 'Khan Academy' },
  { url: 'https://www.nasa.gov', label: 'NASA' },
  { url: 'https://www.nationalgeographic.com', label: 'National Geographic' },
  { url: 'https://www.theguardian.com', label: 'The Guardian' },
  { url: 'https://www.reuters.com', label: 'Reuters' },
  { url: 'https://www.bloomberg.com', label: 'Bloomberg' },
  { url: 'https://www.allrecipes.com', label: 'Allrecipes' },
  { url: 'https://www.webmd.com', label: 'WebMD' },
  { url: 'https://www.mayoclinic.org', label: 'Mayo Clinic' },
  { url: 'https://soundcloud.com', label: 'SoundCloud' },
  { url: 'https://www.rottentomatoes.com', label: 'Rotten Tomatoes' },
  { url: 'https://techcrunch.com', label: 'TechCrunch' },
  { url: 'https://www.theverge.com', label: 'The Verge' },
  { url: 'https://www.bbc.co.uk/news', label: 'BBC News' },
  { url: 'https://www.goodreads.com', label: 'Goodreads' },
  { url: 'https://unsplash.com', label: 'Unsplash' },
  { url: 'https://www.bing.com/search?q=cooking+ideas', label: 'Bing Search' },
  { url: 'https://www.paypal.com', label: 'PayPal' },
]

// Random search queries for human behavior simulation during video creation
const RANDOM_SEARCH_QUERIES = [
  'how to make coffee at home',
  'best movies 2026',
  'world news today',
  'funny cat videos',
  'recipe for chocolate cake',
  'weather forecast tomorrow',
  'top 10 travel destinations',
  'how to learn programming',
  'latest smartphone reviews',
  'morning workout routine',
  'healthy breakfast ideas',
  'best books to read',
  'how to meditate',
  'diy home decoration ideas',
  'popular music playlist 2026',
  'what is artificial intelligence',
  'how to cook pasta',
  'tips for better sleep',
  'free online courses',
  'history of the internet',
  'simple drawing tutorials',
  'how to grow indoor plants',
  'best budget laptops 2026',
  'yoga for beginners',
  'famous painting artists',
  'how does photosynthesis work',
  'what is blockchain',
  'easy guitar chords for beginners',
]

export type WarmingProgress = {
  current: number
  total: number
  siteName: string
  phase: 'visiting' | 'scrolling' | 'done' | 'error'
}

function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, randomBetween(minMs, maxMs)))
}

/**
 * Simulate realistic scrolling and mouse movement on a page.
 * This helps build GA engagement signals and reCAPTCHA trust.
 */
async function simulateHumanInteraction(page: Page): Promise<void> {
  try {
    const viewportSize = page.viewportSize() ?? { width: 1280, height: 700 }
    const scrollSteps = randomBetween(2, 5)
    for (let i = 0; i < scrollSteps; i++) {
      await page.mouse.move(
        randomBetween(100, viewportSize.width - 100),
        randomBetween(100, viewportSize.height - 100)
      )
      await randomDelay(200, 600)
      const scrollAmount = randomBetween(200, 500)
      await page.mouse.wheel(0, scrollAmount)
      await randomDelay(400, 1200)
    }

    // Occasionally hover over random links
    if (Math.random() > 0.5) {
      const links = page.locator('a[href]')
      const count = await links.count().catch(() => 0)
      if (count > 0) {
        const targetIdx = randomBetween(0, Math.min(count - 1, 10))
        await links.nth(targetIdx).hover({ timeout: 2000 }).catch(() => {})
        await randomDelay(300, 800)
      }
    }
  } catch {
    // page may have navigated away; ignore interaction errors
  }
}

/**
 * Visit 15–20 popular GA-enabled websites to build a realistic profile.
 * Each site: navigate → wait load → simulate interaction → pause.
 * Total duration: ~1–2 minutes.
 *
 * @param ctx        Browser context (the Veo3 profile's persistent context)
 * @param onProgress Optional callback for UI updates
 * @param shouldStop Optional callback to abort early
 * @returns          Number of sites successfully visited
 */
export async function warmProfile(
  ctx: BrowserContext,
  onProgress?: (p: WarmingProgress) => void,
  shouldStop?: () => boolean
): Promise<number> {
  const sites = shuffleArray(GA_SITES).slice(0, randomBetween(15, 20))
  let visited = 0

  let warmPage: Page | null = null
  try {
    warmPage = await ctx.newPage()
  } catch {
    return 0
  }

  for (let i = 0; i < sites.length; i++) {
    if (shouldStop?.()) break
    const site = sites[i]
    onProgress?.({ current: i + 1, total: sites.length, siteName: site.label, phase: 'visiting' })

    try {
      await warmPage.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 15000 })
      await randomDelay(1500, 3000)

      onProgress?.({ current: i + 1, total: sites.length, siteName: site.label, phase: 'scrolling' })
      await simulateHumanInteraction(warmPage)
      await randomDelay(1000, 2500)
      visited++
    } catch {
      onProgress?.({ current: i + 1, total: sites.length, siteName: site.label, phase: 'error' })
      await randomDelay(500, 1000)
    }
  }

  // Close the warming tab
  try {
    await warmPage.close()
  } catch {
    // ignore
  }

  onProgress?.({ current: sites.length, total: sites.length, siteName: '', phase: 'done' })
  return visited
}

/**
 * Quick cookie refresh — revisit a few key Google properties to keep cookies fresh.
 * Much lighter than full warm (5–8 sites, ~30s).
 */
export async function refreshProfileCookies(
  ctx: BrowserContext,
  shouldStop?: () => boolean
): Promise<number> {
  const googleSites = GA_SITES.filter((s) =>
    /google\.com|youtube\.com|gmail\.com|drive\.google\.com|docs\.google\.com/i.test(s.url)
  )
  const otherSites = GA_SITES.filter(
    (s) => !googleSites.includes(s)
  )
  const sites = [
    ...shuffleArray(googleSites).slice(0, 3),
    ...shuffleArray(otherSites).slice(0, randomBetween(3, 5)),
  ]

  let refreshed = 0
  let page: Page | null = null
  try {
    page = await ctx.newPage()
  } catch {
    return 0
  }

  for (const site of sites) {
    if (shouldStop?.()) break
    try {
      await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 12000 })
      await randomDelay(1000, 2000)
      await simulateHumanInteraction(page)
      await randomDelay(500, 1500)
      refreshed++
    } catch {
      await randomDelay(300, 600)
    }
  }

  try {
    await page.close()
  } catch {
    // ignore
  }
  return refreshed
}

/**
 * Open a new tab with a random Google search query, browse briefly, then close.
 * Uses a busy-lock: skips silently if the main flow is in a critical section
 * (uploading, submitting, downloading). After closing the random tab, restores
 * focus to the main flow page to prevent focus-theft issues.
 *
 * @param ctx          The browser context
 * @param mainPage     The primary flow page (focus is restored to it after tab closes)
 * @param isFlowBusy   Callback that returns true when the main flow is in a critical section
 * @param durationMs   How long to keep the tab open (default 8–18 seconds)
 */
export async function simulateHumanTab(
  ctx: BrowserContext,
  mainPage?: Page,
  isFlowBusy?: () => boolean,
  durationMs?: number
): Promise<void> {
  if (isFlowBusy?.()) return

  const query = RANDOM_SEARCH_QUERIES[Math.floor(Math.random() * RANDOM_SEARCH_QUERIES.length)]
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`
  const keepAlive = durationMs ?? randomBetween(8000, 18000)

  let tab: Page | null = null
  try {
    tab = await ctx.newPage()
    await tab.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 12000 })
    await randomDelay(1500, 3000)

    if (isFlowBusy?.()) {
      await tab.close().catch(() => {})
      await restoreFocus(mainPage)
      return
    }

    await simulateHumanInteraction(tab)

    if (Math.random() > 0.4) {
      const firstResult = tab.locator('#search a[href]').first()
      const resultVisible = await firstResult.isVisible({ timeout: 2000 }).catch(() => false)
      if (resultVisible && !isFlowBusy?.()) {
        await firstResult.click({ timeout: 3000 }).catch(() => {})
        await randomDelay(2000, 4000)
        if (!isFlowBusy?.()) await simulateHumanInteraction(tab)
      }
    }

    const elapsed = 5000
    const remaining = Math.max(0, keepAlive - elapsed)
    if (remaining > 0) await randomDelay(remaining * 0.5, remaining)
  } catch {
    // best-effort
  } finally {
    try { await tab?.close() } catch { /* ignore */ }
    await restoreFocus(mainPage)
  }
}

async function restoreFocus(page?: Page): Promise<void> {
  if (!page) return
  try {
    if (!page.isClosed()) {
      await (page as any).bringToFront?.()
    }
  } catch { /* ignore */ }
}

// ─── Human behavior scheduler for use during video generation ────────────────

export type HumanBehaviorHandle = {
  stop: () => void
}

/**
 * Start a background loop that periodically opens random search tabs.
 * Respects the flow busy-lock: if the main flow is uploading/submitting/downloading
 * the random tab is silently skipped. After each tab, focus is restored to mainPage.
 *
 * @param ctx            Browser context
 * @param mainPage       The primary flow page (for focus restoration)
 * @param isFlowBusy     Returns true when the main flow is doing critical work
 * @param intervalMinMs  Min interval between tabs (default 90s)
 * @param intervalMaxMs  Max interval between tabs (default 240s)
 */
export function startHumanBehaviorLoop(
  ctx: BrowserContext,
  mainPage?: Page,
  isFlowBusy?: () => boolean,
  intervalMinMs: number = 90_000,
  intervalMaxMs: number = 240_000
): HumanBehaviorHandle {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const scheduleNext = () => {
    if (stopped) return
    const delay = randomBetween(intervalMinMs, intervalMaxMs)
    timer = setTimeout(async () => {
      if (stopped) return
      try {
        await simulateHumanTab(ctx, mainPage, isFlowBusy)
      } catch {
        // ignore
      }
      scheduleNext()
    }, delay)
  }

  timer = setTimeout(async () => {
    if (stopped) return
    try {
      await simulateHumanTab(ctx, mainPage, isFlowBusy)
    } catch {
      // ignore
    }
    scheduleNext()
  }, randomBetween(30_000, 60_000))

  return {
    stop: () => {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}
