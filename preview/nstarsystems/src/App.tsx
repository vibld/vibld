import Nav from './components/Nav'
import Hero from './components/Hero'
import Solutions from './components/Solutions'
import Stats from './components/Stats'
import Industries from './components/Industries'
import Process from './components/Process'
import About from './components/About'
import Testimonials from './components/Testimonials'
import Contact from './components/Contact'
import Footer from './components/Footer'
import { useScrollMotion } from './hooks/useScrollMotion'
import { useReveal } from './hooks/useReveal'

export default function App() {
  useScrollMotion()
  useReveal()

  return (
    <>
      <div className="page-backdrop" aria-hidden="true" />

      <a className="skip-link" href="#solutions">
        Skip to main content
      </a>

      <Nav />

      <main className="page-main">
        <Hero />
        <Solutions />
        <Stats />
        <Industries />
        <Process />
        <About />
        <Testimonials />
        <Contact />
      </main>

      <Footer />
    </>
  )
}
