/**
 * Parse the Veo3 generated content list (virtuoso-item-list) into a structured data object.
 * Layout: rows by data-index (process row 1 first, then row 0). Within each row: left = newest,
 * right = oldest; rightmost tile = uploaded image (1.png, 2.png), tiles to its left = videos
 * (newest..oldest). Failed tile occupies a video slot (e.g. 5.mp4); retry makes it disappear
 * and a new generating tile appears to the left (that will become 5.mp4 when done).
 *
 * See: src/html_inpects/veo3_03072026/generated_content_list.html
 *
 * Failed generations: Flow shows several error UIs (different copy/classes). The stable signal is
 * the generation retry control: material icon "refresh" and/or accessible "Try again" / "Thử lại".
 */

export type GeneratedTileType = 'video' | 'image' | 'failed' | 'generating'

export interface GeneratedTileBase {
  tileId: string
  type: GeneratedTileType
  /** Link href (a.href) when present */
  href: string | null
  /** Stable workflow/job id parsed from href (/edit/<workflowId>) when present. */
  workflowId: string | null
  /** Position in row (0 = leftmost) */
  positionInRow: number
}

export interface VideoTile extends GeneratedTileBase {
  type: 'video'
  /** Output filename: 1.mp4, 2.mp4, ... */
  outputFileName: string
  /** 1-based index for this video (1 = 1.mp4) */
  videoIndex: number
  videoSrc: string | null
  /** Thumbnail img src when present */
  imgSrc: string | null
}

export interface ImageTile extends GeneratedTileBase {
  type: 'image'
  /** Output filename: 1.png, 2.png, ... */
  outputFileName: string
  /** 1-based image index (1 = 1.png) */
  imageIndex: number
  imgSrc: string | null
}

export interface FailedTile extends GeneratedTileBase {
  type: 'failed'
  /** Output filename this slot would be when retried (e.g. 5.mp4) */
  outputFileName: string
  videoIndex: number
  errorMessage: string | null
  /** Has retry button (refresh / Thử lại); click to retry */
  hasRetry: boolean
}

export interface GeneratingTile extends GeneratedTileBase {
  type: 'generating'
  /** Output filename when done (e.g. 5.mp4) */
  outputFileName: string
  videoIndex: number
}

export type ParsedTile = VideoTile | ImageTile | FailedTile | GeneratingTile

export interface ParsedRow {
  /** data-index value (e.g. 1, 0) — row 1 processed first */
  dataIndex: number
  /** Tiles left-to-right (newest video … oldest video, then image) */
  tiles: ParsedTile[]
  /** 1-based image index for this row (1.png, 2.png) */
  imageIndex: number
}

export interface ParsedGeneratedList {
  /** Rows in process order: higher data-index first (e.g. [row1, row0]) */
  rows: ParsedRow[]
  /** All video tiles (completed) in download order: 1.mp4, 2.mp4, ... */
  videos: VideoTile[]
  /** All image tiles in order: 1.png, 2.png, ... */
  images: ImageTile[]
  /** Failed tiles (need retry); each has outputFileName e.g. 5.mp4 */
  failed: FailedTile[]
  /** Generating tiles (wait for completion); each has outputFileName when done */
  generating: GeneratingTile[]
  /** Total count of video slots (completed + failed + generating) */
  totalVideoSlots: number
}

/** Build a one-line layout string in prompt order (1.mp4, 2.mp4, … then image). Rows by data-index ascending. Within each row: videos in prompt order (1→N) then image. */
export function parsedListToLayoutString(data: ParsedGeneratedList): string {
  if (data.rows.length === 0) return '(empty)'
  const parts: string[] = []
  const rowsAsc = [...data.rows].sort((a, b) => a.dataIndex - b.dataIndex)
  for (const row of rowsAsc) {
    const tiles = row.tiles
    if (tiles.length === 0) continue
    const videoTiles = tiles.slice(0, -1)
    const imageTile = tiles[tiles.length - 1]
    const inPromptOrder = [...videoTiles].reverse().concat([imageTile])
    for (const t of inPromptOrder) {
      if (t.type === 'failed') parts.push(`${t.outputFileName} (failed)`)
      else if (t.type === 'generating') parts.push(`${t.outputFileName} (generating)`)
      else parts.push(t.outputFileName)
    }
  }
  return parts.join(' | ')
}

/** Same order as parsedListToLayoutString but each element on its own line with video.src / img.src and a.href. */
export function parsedListToVerboseLayoutString(data: ParsedGeneratedList): string {
  if (data.rows.length === 0) return '(empty)'
  const lines: string[] = []
  const rowsAsc = [...data.rows].sort((a, b) => a.dataIndex - b.dataIndex)
  for (const row of rowsAsc) {
    const tiles = row.tiles
    if (tiles.length === 0) continue
    const videoTiles = tiles.slice(0, -1)
    const imageTile = tiles[tiles.length - 1]
    const inPromptOrder = [...videoTiles].reverse().concat([imageTile])
    for (const t of inPromptOrder) {
      const label = t.type === 'failed'
        ? `${t.outputFileName} (failed)`
        : t.type === 'generating'
          ? `${t.outputFileName} (generating)`
          : t.outputFileName
      const hrefPart = t.href != null ? `  a.href=${t.href}` : ''
      if (t.type === 'video') {
        const srcPart = t.videoSrc != null ? `  video.src=${t.videoSrc}` : ''
        lines.push(`  ${label}${srcPart}${hrefPart}`)
      } else if (t.type === 'image') {
        const srcPart = t.imgSrc != null ? `  img.src=${t.imgSrc}` : ''
        lines.push(`  ${label}${srcPart}${hrefPart}`)
      } else {
        lines.push(`  ${label}${hrefPart}`)
      }
    }
  }
  return lines.join('\n')
}

/**
 * Parses the generated content list. Runs in browser (e.g. page.evaluate).
 * Pass the list container selector. Returns the parsed data object.
 * Use: page.evaluate(parseGeneratedContentListInPage, S.generatedListContainer)
 */
export function parseGeneratedContentListInPage(selector: string): ParsedGeneratedList {
    /** True if this tile has Flow's "retry this generation" action (all failed variants expose it). */
    function tileHasFailedGenerationRetry(el: HTMLElement): boolean {
      for (const btn of el.querySelectorAll('button')) {
        const a11y = `${btn.getAttribute('aria-label') ?? ''} ${btn.getAttribute('title') ?? ''}`.toLowerCase()
        if (/\b(retry|try again|thử lại)\b/.test(a11y)) return true
        for (const icon of btn.querySelectorAll('i')) {
          const t = (icon.textContent ?? '').trim().toLowerCase()
          if (t === 'refresh' || t.includes('refresh')) return true
        }
        for (const span of btn.querySelectorAll('span')) {
          const tx = (span.textContent ?? '').trim().toLowerCase()
          // Flow uses visually hidden sr-only text; allow substring / any casing (Unicode)
          if (tx.includes('thử lại') || tx.includes('try again') || /^retry$/i.test(tx.trim())) return true
        }
      }
      return false
    }

    const container = document.querySelector(selector) as HTMLElement | null
    if (!container) return { rows: [], videos: [], images: [], failed: [], generating: [], totalVideoSlots: 0 }

    const rowEls = Array.from(container.querySelectorAll('[data-index]')) as HTMLElement[]
    const rowsWithIndex = rowEls
      .map((el) => ({ dataIndex: parseInt(el.getAttribute('data-index') ?? '', 10), el }))
      .filter(({ dataIndex }) => !isNaN(dataIndex))
      .sort((a, b) => b.dataIndex - a.dataIndex) // descending: row 1 first, then row 0

    const result: ParsedGeneratedList = {
      rows: [],
      videos: [],
      images: [],
      failed: [],
      generating: [],
      totalVideoSlots: 0,
    }

    let globalVideoIndex = 0

    for (let r = 0; r < rowsWithIndex.length; r++) {
      const { dataIndex, el: rowEl } = rowsWithIndex[r]
      const imageIndex = r + 1 // 1.png for first row, 2.png for second, ...
      const inner = rowEl.querySelector(':scope > div')
      const tileWrappers = inner ? Array.from(inner.children) as HTMLElement[] : []
      const tiles: ParsedTile[] = []

      for (let i = 0; i < tileWrappers.length; i++) {
        const wrapper = tileWrappers[i]
        const tileEl = wrapper.querySelector('[data-tile-id]') as HTMLElement | null
        if (!tileEl) continue

        const tileId = tileEl.getAttribute('data-tile-id') ?? ''
        const a = tileEl.querySelector('a[href]') as HTMLAnchorElement | null
        const href = a ? a.getAttribute('href') : null
        const workflowIdMatch = href ? /\/edit\/([^/?#]+)/.exec(href) : null
        const workflowId = workflowIdMatch ? workflowIdMatch[1] : null

        const img = tileEl.querySelector('img[src*="getMediaUrlRedirect"]') as HTMLImageElement | null
        /** Only a real Flow output counts as "completed"; broad `video[src*="Redirect"]` can false-positive and hide policy/other failed tiles. */
        const videoCompleted = tileEl.querySelector(
          'video[src*="getMediaUrlRedirect"]'
        ) as HTMLVideoElement | null
        const videoLoose =
          videoCompleted ||
          (tileEl.querySelector('video[src*="Redirect"]') as HTMLVideoElement | null)
        const hasProgress = !!tileEl.querySelector('.sc-55ebc859-7') // generating progress %

        // Generating: has progress % (check before failed — same tile can have both blocks in DOM, progress is current state)
        if (hasProgress && !videoCompleted) {
          globalVideoIndex++
          const tile: GeneratingTile = {
            type: 'generating',
            tileId,
            href,
            workflowId,
            positionInRow: i,
            outputFileName: `${globalVideoIndex}.mp4`,
            videoIndex: globalVideoIndex,
          }
          tiles.push(tile)
          result.generating.push(tile)
          continue
        }

        // Image tile: has .sc-5923b123-0 (uploaded image), has img, no video — before failed so uploads are never misread as failed
        const isImageTile = !!tileEl.querySelector('.sc-5923b123-0')

        if (img && !videoLoose && isImageTile) {
          const tile: ImageTile = {
            type: 'image',
            tileId,
            href,
            workflowId,
            positionInRow: i,
            outputFileName: `${imageIndex}.png`,
            imageIndex,
            imgSrc: img.getAttribute('src'),
          }
          tiles.push(tile)
          result.images.push(tile)
          continue
        }

        // Failed: any Flow error layout — stable signal is the generation retry control (refresh / Try again / Thử lại).
        // Fallback: known title/error regions if Google changes the button shape but copy remains.
        const hasRetry = tileHasFailedGenerationRetry(tileEl)
        const failedBlockOld = tileEl.querySelector('.sc-9a984650-1.dEfdsQ')
        const failedBlockNew = tileEl.querySelector('.sc-25d34a31-1')
        const text = tileEl.textContent ?? ''
        const failedByViTitle = text.includes('Không thành công')
        const failedByEnCopy = text.includes('Something went wrong')
        // Policy / safety copy (failed_item_2.html) — different body text, same retry row
        const failedByPolicyVi =
          text.includes('chính sách') || text.includes('vi phạm') || text.includes('vi pham')
        const looksFailedByCopy = !!(
          failedBlockOld ||
          failedBlockNew ||
          failedByViTitle ||
          failedByEnCopy ||
          failedByPolicyVi
        )
        if (!videoCompleted && !hasProgress && (hasRetry || looksFailedByCopy)) {
          const errorEl =
            tileEl.querySelector('.sc-9a984650-2') || tileEl.querySelector('.sc-25d34a31-2')
          const errorMessage = errorEl ? (errorEl.textContent ?? '').trim() : null
          globalVideoIndex++
          const tile: FailedTile = {
            type: 'failed',
            tileId,
            href,
            workflowId,
            positionInRow: i,
            outputFileName: `${globalVideoIndex}.mp4`,
            videoIndex: globalVideoIndex,
            errorMessage,
            // All Flow failed generations expose retry; if DOM hides icon text, still allow tracker to wait / click
            hasRetry: hasRetry || looksFailedByCopy,
          }
          tiles.push(tile)
          result.failed.push(tile)
          continue
        }

        // Rightmost tile with img and no video (fallback for image)
        const isRightmost = i === tileWrappers.length - 1
        if (img && !videoLoose && !hasProgress && isRightmost) {
          const tile: ImageTile = {
            type: 'image',
            tileId,
            href,
            workflowId,
            positionInRow: i,
            outputFileName: `${imageIndex}.png`,
            imageIndex,
            imgSrc: img.getAttribute('src'),
          }
          tiles.push(tile)
          result.images.push(tile)
          continue
        }

        // Completed video — add to row tiles only; result.videos built in second pass in prompt order
        if (videoLoose) {
          const thumb = tileEl.querySelector('img[src*="getMediaUrlRedirect"]') as HTMLImageElement | null
          const tile: VideoTile = {
            type: 'video',
            tileId,
            href,
            workflowId,
            positionInRow: i,
            outputFileName: '',
            videoIndex: 0,
            videoSrc: videoLoose.getAttribute('src'),
            imgSrc: thumb ? thumb.getAttribute('src') : null,
          }
          tiles.push(tile)
        }
      }

      result.rows.push({ dataIndex, tiles, imageIndex })
    }

    // Second pass: assign slot numbers (1, 2, 3, ...) in prompt order; only completed videos get
    // outputFileName and go into result.videos. Failed/generating tiles count as slots but are not
    // downloadable yet. Layout has evolved so the uploaded image is not always the rightmost tile
    // (it can be leftmost), so we must EXPLICITLY exclude tiles of type "image" instead of assuming
    // "all but last" are videos.
    result.videos = []
    let slotIndex = 0
    for (const row of result.rows) {
      const tiles = row.tiles
      if (tiles.length === 0) continue
      const videoSlots = tiles.filter(t => t.type !== 'image')
      const inPromptOrder = videoSlots.slice().reverse()
      for (const t of inPromptOrder) {
        slotIndex++
        if (t.type === 'video') {
          const v = t as VideoTile
          v.outputFileName = `${slotIndex}.mp4`
          v.videoIndex = slotIndex
          result.videos.push(v)
        } else if (t.type === 'failed') {
          const f = t as FailedTile
          f.outputFileName = `${slotIndex}.mp4`
          f.videoIndex = slotIndex
        } else if (t.type === 'generating') {
          const g = t as GeneratingTile
          g.outputFileName = `${slotIndex}.mp4`
          g.videoIndex = slotIndex
        }
      }
    }
    result.totalVideoSlots = slotIndex
    return result
  }

/**
 * Run the parser in the page. Pass the list container selector (e.g. VEO3_SELECTORS.generatedListContainer).
 * Returns the parsed data object. Use: page.evaluate(parseGeneratedContentListInPage, selector)
 */
export async function parseGeneratedListInPage(
  evaluate: <T>(fn: (selector: string) => T, arg: string) => Promise<T>,
  listSelector: string
): Promise<ParsedGeneratedList> {
  return evaluate(parseGeneratedContentListInPage, listSelector)
}
