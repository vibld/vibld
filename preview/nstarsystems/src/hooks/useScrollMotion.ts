import { useEffect } from 'react'

/**
 * Publishes scroll position and pointer position to CSS custom properties on
 * the document root so any layer can parallax against them.
 *
 * --scroll-y        raw scroll offset in pixels (unitless number)
 * --scroll-progress page scroll progress from 0 to 1
 * --px / --py       pointer position normalised from -1 to 1
 */
export function useScrollMotion(): void {
  useEffect(() => {
    const root = document.documentElement
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let frame = 0
    let pointerX = 0
    let pointerY = 0

    const apply = () => {
      frame = 0
      const scrollY = window.scrollY
      const max = document.documentElement.scrollHeight - window.innerHeight
      const progress = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0

      root.style.setProperty('--scroll-y', String(Math.round(scrollY)))
      root.style.setProperty('--scroll-progress', progress.toFixed(4))
      root.style.setProperty('--px', pointerX.toFixed(4))
      root.style.setProperty('--py', pointerY.toFixed(4))
    }

    const request = () => {
      if (frame === 0) {
        frame = window.requestAnimationFrame(apply)
      }
    }

    const onScroll = () => request()

    const onPointerMove = (event: PointerEvent) => {
      pointerX = (event.clientX / window.innerWidth) * 2 - 1
      pointerY = (event.clientY / window.innerHeight) * 2 - 1
      request()
    }

    apply()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)

    if (!reduced) {
      window.addEventListener('pointermove', onPointerMove, { passive: true })
    }

    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      window.removeEventListener('pointermove', onPointerMove)
      if (frame) {
        window.cancelAnimationFrame(frame)
      }
    }
  }, [])
}
