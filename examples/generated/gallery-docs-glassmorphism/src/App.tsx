import { useEffect, useState } from 'react';
import { MotionConfig } from 'motion/react';
import SiteLayout from '@/components/SiteLayout';
import Home from '@/pages/Home';
import Installation from '@/pages/Installation';
import QuickStart from '@/pages/QuickStart';
import CommandReference from '@/pages/CommandReference';

function getPage(hash: string) {
  switch (hash) {
    case '#/install':
      return <Installation />;
    case '#/quick-start':
      return <QuickStart />;
    case '#/commands':
      return <CommandReference />;
    default:
      return <Home />;
  }
}

export default function App() {
  const [hash, setHash] = useState(() => window.location.hash || '#/');

  useEffect(() => {
    const handleHashChange = () => {
      setHash(window.location.hash || '#/');
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <SiteLayout>{getPage(hash)}</SiteLayout>
    </MotionConfig>
  );
}
