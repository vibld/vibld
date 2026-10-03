import { motion } from 'motion/react';
import { fadeIn } from '@/lib/motion';

const galleryItems = [
  {
    src: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=1200&q=80',
    alt: 'Editorial portrait, Lisbon',
    category: 'Portrait',
    caption: 'Editorial portrait, Lisbon',
    span: 'lg:col-span-6',
  },
  {
    src: 'https://images.unsplash.com/photo-1610701596007-11502861dcfa?auto=format&fit=crop&w=1200&q=80',
    alt: 'Still life with ceramics',
    category: 'Still life',
    caption: 'Still life with ceramics',
    span: 'lg:col-span-6',
  },
  {
    src: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=1200&q=80',
    alt: 'Studio fashion, Copenhagen',
    category: 'Fashion',
    caption: 'Studio fashion, Copenhagen',
    span: 'lg:col-span-4',
  },
  {
    src: 'https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=1200&q=80',
    alt: 'Kitchen story for a food magazine',
    category: 'Editorial',
    caption: 'Kitchen story for a food magazine',
    span: 'lg:col-span-4',
  },
  {
    src: 'https://images.unsplash.com/photo-1523217582562-09d0def993a6?auto=format&fit=crop&w=1200&q=80',
    alt: 'Architectural detail, Porto',
    category: 'Architecture',
    caption: 'Architectural detail, Porto',
    span: 'lg:col-span-4',
  },
  {
    src: 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=1200&q=80',
    alt: 'Window light portrait',
    category: 'Portrait',
    caption: 'Window light portrait',
    span: 'lg:col-span-4',
  },
];

export default function Gallery() {
  return (
    <motion.section
      id="gallery"
      variants={fadeIn}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.3 }}
      className="max-w-[var(--page-max)] mx-auto px-[var(--gutter)] py-[var(--section-y)]"
    >
      <h2 className="font-display text-[clamp(1.8rem,3.5vw,2.5rem)] leading-[1.15] tracking-[-0.01em] text-foreground">
        Recent work
      </h2>
      <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-6">
        {galleryItems.map((item) => (
          <figure key={item.caption} className={`relative ${item.span}`}>
            <img
              src={item.src}
              alt={item.alt}
              className="w-full h-auto object-cover aspect-[4/3] rounded-none"
              loading="lazy"
            />
            <figcaption className="absolute bottom-0 left-0 right-0 p-4 image-caption">
              <span className="block text-sm font-medium text-foreground">
                {item.category}
              </span>
              <span className="block text-sm text-muted-foreground mt-1">
                {item.caption}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </motion.section>
  );
}
