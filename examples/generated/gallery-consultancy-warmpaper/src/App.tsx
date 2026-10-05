import { useEffect, useState } from 'react';
import { MotionConfig } from 'motion/react';
import SiteLayout from '@/components/SiteLayout';
import HomePage from '@/pages/Home';
import ServicesPage from '@/pages/Services';
import CaseStudiesPage from '@/pages/CaseStudies';
import ContactPage from '@/pages/Contact';

function getRouteFromHash(): string {
  const hash = window.location.hash || '#/';
  return hash;
}

export default function App() {
  const [route, setRoute] = useState(getRouteFromHash);

  useEffect(() => {
    const handleHashChange = () => setRoute(getRouteFromHash());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  let page;
  switch (route) {
    case '#/services':
      page = <ServicesPage />;
      break;
    case '#/case-studies':
      page = <CaseStudiesPage />;
      break;
    case '#/contact':
      page = <ContactPage />;
      break;
    default:
      page = <HomePage />;
  }

  return (
    <MotionConfig reducedMotion="user">
      <SiteLayout>{page}</SiteLayout>
    </MotionConfig>
  );
}
