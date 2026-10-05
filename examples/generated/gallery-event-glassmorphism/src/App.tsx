import { useEffect } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { MotionConfig } from "motion/react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import Home from "@/pages/Home";
import Lineup from "@/pages/Lineup";
import Schedule from "@/pages/Schedule";
import Tickets from "@/pages/Tickets";
import Directions from "@/pages/Directions";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <ScrollToTop />
        <div className="min-h-svh bg-background text-foreground">
          <SiteHeader />
          <main>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/lineup" element={<Lineup />} />
              <Route path="/schedule" element={<Schedule />} />
              <Route path="/tickets" element={<Tickets />} />
              <Route path="/directions" element={<Directions />} />
              <Route path="*" element={<Home />} />
            </Routes>
          </main>
          <SiteFooter />
        </div>
      </BrowserRouter>
    </MotionConfig>
  );
}
