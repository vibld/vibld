import { useEffect, useState } from 'react';
import { MotionConfig } from 'motion/react';
import Home from '@/pages/Home';
import Bio from '@/pages/Bio';
import Contact from '@/pages/Contact';

const getPathname = () => window.location.pathname;

export default function App() {
  const [pathname, setPathname] = useState(getPathname());

  useEffect(() => {
    const handlePopState = () => {
      setPathname(getPathname());
    };
    window.addEventListener('popstate', handlePopState);

    // Intercept internal link clicks to use history.pushState for SPA navigation
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const anchor = target.closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('http') || href.startsWith('//')) return;
      // Ignore hash links within the same page
      if (href.startsWith('#')) return;
      const url = new URL(href, window.location.origin);
      if (url.origin !== window.location.origin) return;
      event.preventDefault();
      window.history.pushState({}, '', href);
      setPathname(getPathname());
      window.scrollTo({ top: 0, behavior: 'auto' });
    };

    document.addEventListener('click', handleClick);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      document.removeEventListener('click', handleClick);
    };
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [pathname]);

  let page;
  switch (pathname) {
    case '/bio':
      page = <Bio />;
      break;
    case '/contact':
      page = <Contact />;
      break;
    case '/':
    default:
      page = <Home />;
      break;
  }

  return <MotionConfig reducedMotion="user">{page}</MotionConfig>;
}
