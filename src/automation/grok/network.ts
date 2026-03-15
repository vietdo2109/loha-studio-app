/**
 * Grok network intercept — capture media URLs from analytics and asset requests.
 */
import { isVideoOutput } from '../types'
import type { GrokWorkerContext, GrokJob } from './context'

export function setupNetworkIntercept(ctx: GrokWorkerContext, job: GrokJob): void {
  const { page, log, getCapturedMediaUrl, setCapturedMediaUrl, getUpscaledMediaUrl, setUpscaledMediaUrl } = ctx

  page.on('request', (req) => {
    const url    = req.url()
    const method = req.method()

    if (url.includes('/_data/v1/a/t/') && method === 'POST') {
      try {
        const postData = req.postData() ?? ''
        const match    = postData.match(/data=([^&]+)/)
        if (!match) return

        const events = JSON.parse(atob(decodeURIComponent(match[1]))) as { event: string; properties?: Record<string, string> }[]
        for (const evt of events) {
          const props = evt.properties ?? {}

          if (evt.event === 'image_feed_video_generated' && props.video_url && !getCapturedMediaUrl()) {
            setCapturedMediaUrl(`https://assets.grok.com/${props.video_url}?cache=1`)
            log('info', 'video_url captured (analytics)')
          }

          if ((evt.event === 'image_feed_image_generated' || evt.event === 'image_feed_created')
              && !isVideoOutput(job) && props.image_url && !getCapturedMediaUrl()) {
            setCapturedMediaUrl(props.image_url.startsWith('http')
              ? props.image_url
              : `https://assets.grok.com/${props.image_url}`)
            log('info', 'image_url captured (analytics)')
          }
        }
      } catch { /* ignore */ }
      return
    }

    if (!url.includes('assets.grok.com')) return

    if (url.includes('generated_video_hd.mp4') && !getUpscaledMediaUrl()) {
      setUpscaledMediaUrl(url)
      log('info', 'upscaled HD URL captured')
      return
    }

    if (url.includes('generated_video.mp4') && !getCapturedMediaUrl()) {
      setCapturedMediaUrl(url)
      log('info', 'video URL captured (fallback)')
    }

    if (!isVideoOutput(job) && !getCapturedMediaUrl()
        && (url.includes('.jpg') || url.includes('.png') || url.includes('.webp'))) {
      setCapturedMediaUrl(url)
      log('info', 'image URL captured (fallback)')
    }
  })
}
