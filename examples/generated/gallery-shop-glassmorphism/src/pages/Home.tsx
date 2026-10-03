import HomeHero from '@/components/HomeHero';
import FeaturedProducts from '@/components/FeaturedProducts';
import AllProducts from '@/components/AllProducts';
import AboutSection from '@/components/AboutSection';
import { products } from '@/lib/products';

export default function Home() {
  return (
    <>
      <HomeHero />
      <FeaturedProducts products={products} />
      <AllProducts products={products} />
      <AboutSection />
    </>
  );
}
