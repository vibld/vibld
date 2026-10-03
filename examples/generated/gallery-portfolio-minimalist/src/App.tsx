import { useEffect, useState } from 'react';
import { MotionConfig } from 'motion/react';
import SiteLayout from '@/components/SiteLayout';
import Home from '@/pages/Home';
import Contact from '@/pages/Contact';

function getRouteFromHash(): 'home' | 'contact' {
  const path = window.location.hash.replace(/^#\/?/, '');
  return path === 'contact' ? 'contact' : 'home';
}

export default function App() {
  const [route, setRoute] = useState<'home' | 'contact'>(() => getRouteFromHash());

  useEffect(() => {
    const onHashChange = () => {
      setRoute(getRouteFromHash());
      window.scrollTo(0, 0);
    };

    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <SiteLayout>
        {route === 'contact' ? <Contact /> : <Home />}
      </SiteLayout>
    </MotionConfig>
  );
}
