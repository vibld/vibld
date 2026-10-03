import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import SiteLayout from '@/components/SiteLayout';
import Home from '@/pages/Home';
import Lineup from '@/pages/Lineup';
import Schedule from '@/pages/Schedule';
import Tickets from '@/pages/Tickets';
import Directions from '@/pages/Directions';

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<SiteLayout />}>
            <Route index element={<Home />} />
            <Route path="lineup" element={<Lineup />} />
            <Route path="schedule" element={<Schedule />} />
            <Route path="tickets" element={<Tickets />} />
            <Route path="directions" element={<Directions />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </MotionConfig>
  );
}
