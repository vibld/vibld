import Logo from './Logo'
import { footerColumns } from '../data/content'

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer__glow" aria-hidden="true" />
      <div className="shell">
        <div className="footer__top">
          <div className="footer__brand">
            <a className="brand brand--light" href="#top">
              <Logo id="footer" />
              <span className="brand__text">
                <strong>NStar</strong>
                <span>Systems</span>
              </span>
            </a>
            <p className="footer__note">
              NStar Systems designs, deploys and manages the networks, cloud platforms and security
              programs that keep growing organizations running.
            </p>
          </div>

          {footerColumns.map((column) => (
            <nav className="footer__col" key={column.title} aria-label={column.title}>
              <h3 className="footer__title">{column.title}</h3>
              {column.links.map((link) => (
                <a className="footer__link" href={link.href} key={link.label}>
                  {link.label}
                </a>
              ))}
            </nav>
          ))}

          <div className="footer__col">
            <h3 className="footer__title">Contact</h3>
            <a className="footer__link" href="mailto:hello@nstarsystems.com">
              hello@nstarsystems.com
            </a>
            <a className="footer__link" href="tel:+15085550142">
              (508) 555-0142
            </a>
            <span className="footer__link footer__link--static">
              118 Turnpike Road, Suite 210
              <br />
              Westborough, MA 01581
            </span>
          </div>
        </div>

        <div className="footer__bottom">
          <p>© 2025 NStar Systems. All rights reserved.</p>
          <p className="footer__legal">
            <a href="#top">Privacy Policy</a>
            <a href="#top">Terms of Service</a>
            <a href="#contact">Support</a>
          </p>
        </div>
      </div>
    </footer>
  )
}
