import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import SiteLayout from '@/components/SiteLayout';
import Home from '@/pages/Home';
import Installation from '@/pages/Installation';
import QuickStart from '@/pages/QuickStart';
import CommandReference from '@/pages/CommandReference';

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<SiteLayout><Home /></SiteLayout>} />
          <Route path="/installation" element={<SiteLayout><Installation /></SiteLayout>} />
          <Route path="/quick-start" element={<SiteLayout><QuickStart /></SiteLayout>} />
          <Route path="/commands" element={<SiteLayout><CommandReference /></SiteLayout>} />
        </Routes>
      </BrowserRouter>
    </MotionConfig>
  );
}
