import { useState } from "react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import HomePage from "@/pages/HomePage";
import ContactPage from "@/pages/ContactPage";

type Page = "home" | "contact";

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>("home");

  const handleNavigate = (page: Page) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <Header currentPage={currentPage} onNavigate={handleNavigate} />
      <main className="flex-1">
        {currentPage === "home" ? (
          <HomePage onNavigateContact={() => handleNavigate("contact")} />
        ) : (
          <ContactPage />
        )}
      </main>
      <Footer />
    </div>
  );
}
