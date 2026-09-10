import { useEffect, useState } from 'react'
import Logo from './Logo'
import { navLinks } from '../data/content'

export default function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 30)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    document.body.classList.toggle('nav-open', open)
    return () => document.body.classList.remove('nav-open')
  }, [open])

  return (
    <header className={`nav${scrolled ? ' nav--scrolled' : ''}${open ? ' nav--open' : ''}`}>
      <div className="shell nav__inner">
        <a className="brand" href="#top" onClick={() => setOpen(false)}>
          <Logo id="nav" />
          <span className="brand__text">
            <strong>NStar</strong>
            <span>Systems</span>
          </span>
        </a>

        <nav className="nav__links" aria-label="Primary">
          {navLinks.map((link) => (
            <a key={link.label} className="nav__link" href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>

        <a className="btn btn--primary btn--sm nav__cta" href="#contact">
          Start a Conversation
        </a>

        <button
          type="button"
          className="nav__toggle"
          aria-expanded={open}
          aria-controls="nav-drawer"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="nav__toggle-bar" />
          <span className="nav__toggle-bar" />
          <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
        </button>
      </div>

      {open ? (
        <div className="nav__drawer" id="nav-drawer">
          {navLinks.map((link) => (
            <a key={link.label} href={link.href} onClick={() => setOpen(false)}>
              {link.label}
            </a>
          ))}
          <a className="btn btn--primary" href="#contact" onClick={() => setOpen(false)}>
            Start a Conversation
          </a>
        </div>
      ) : null}
    </header>
  )
}
