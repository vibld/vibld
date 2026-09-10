import { useEffect, useRef, useState } from 'react'
import { stats } from '../data/content'
import type { Stat } from '../data/content'

function useCountUp(target: number, decimals: number, active: boolean): string {
  const [current, setCurrent] = useState(0)

  useEffect(() => {
    if (!active) {
      return
    }

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reduce) {
      setCurrent(target)
      return
    }

    let frame = 0
    const duration = 1500
    const start = performance.now()

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      setCurrent(target * eased)
      if (progress < 1) {
        frame = window.requestAnimationFrame(tick)
      }
    }

    frame = window.requestAnimationFrame(tick)

    return () => window.cancelAnimationFrame(frame)
  }, [active, target])

  return current.toFixed(decimals)
}

function StatCard({ stat }: { stat: Stat }) {
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) {
      return
    }

    if (typeof IntersectionObserver === 'undefined') {
      setActive(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActive(true)
            observer.disconnect()
          }
        })
      },
      { threshold: 0.4 },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const shown = useCountUp(stat.value, stat.decimals, active)

  return (
    <div className="stat" ref={ref}>
      <span className="stat__rule" aria-hidden="true" />
      <p className="stat__value">
        {shown}
        <span className="stat__suffix">{stat.suffix}</span>
      </p>
      <p className="stat__label">{stat.label}</p>
    </div>
  )
}

export default function Stats() {
  return (
    <section className="section section--dark stats">
      <div className="stats__glow" aria-hidden="true" />
      <div className="shell">
        <div className="section__head section__head--light" data-reveal>
          <p className="eyebrow eyebrow--light">
            <span className="eyebrow__dot" />
            By the numbers
          </p>
          <h2 className="section__title section__title--light">Results we are willing to publish.</h2>
        </div>

        <div className="stats__grid">
          {stats.map((stat) => (
            <StatCard key={stat.label} stat={stat} />
          ))}
        </div>
      </div>
    </section>
  )
}
