import { useEffect, useState } from 'react';
import { MotionConfig } from 'motion/react';
import SiteLayout from '@/components/SiteLayout';
import Home from '@/pages/Home';
import Installation from '@/pages/Installation';
import QuickStart from '@/pages/QuickStart';
import Reference from '@/pages/Reference';

export default function App() {
  const [path, setPath] = useState(() =>
    typeof window !== 'undefined' ? window.location.hash || '#/' : '#/'
  );

  useEffect(() => {
    const onHashChange = () => setPath(window.location.hash || '#/');
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);

  const renderPage = () => {
    switch (path) {
      case '#/installation':
        return <Installation />;
      case '#/quick-start':
        return <QuickStart />;
      case '#/reference':
        return <Reference />;
      case '#/':
        return <Home />;
      default:
        return (
          <SiteLayout>
            <section className='mx-auto max-w-3xl px-4 py-24 sm:px-6 lg:px-8'>
              <h1 className='font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl'>
                Page not found
              </h1>
              <p className='mt-4 font-serif text-lg leading-relaxed text-muted-foreground'>
                The page you are looking for does not exist. Check the URL and try again.
              </p>
              <a
                href='#/'
                className='mt-8 inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              >
                Back to home
              </a>
            </section>
          </SiteLayout>
        );
    }
  };

  return <MotionConfig reducedMotion="user">{renderPage()}</MotionConfig>;
}
