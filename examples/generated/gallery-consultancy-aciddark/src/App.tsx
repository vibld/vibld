import { BrowserRouter, Routes, Route } from "react-router-dom";
import { MotionConfig } from "motion/react";
import Home from "@/pages/Home";
import Services from "@/pages/Services";
import CaseStudies from "@/pages/CaseStudies";
import Contact from "@/pages/Contact";

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/services" element={<Services />} />
          <Route path="/case-studies" element={<CaseStudies />} />
          <Route path="/contact" element={<Contact />} />
        </Routes>
      </BrowserRouter>
    </MotionConfig>
  );
}
