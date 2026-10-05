import Home from '@/pages/Home';
import Installation from '@/pages/Installation';
import QuickStart from '@/pages/QuickStart';
import Reference from '@/pages/Reference';
import { SiteLayout } from '@/components/SiteLayout';

export default function App() {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';

  let page;
  if (pathname === '/installation') {
    page = <Installation />;
  } else if (pathname === '/quick-start') {
    page = <QuickStart />;
  } else if (pathname === '/reference') {
    page = <Reference />;
  } else {
    page = <Home />;
  }

  return <SiteLayout>{page}</SiteLayout>;
}
