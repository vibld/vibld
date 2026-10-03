import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { fadeIn, fadeInView } from '@/lib/motion';

export default function Home() {
  return (
    <>
      <section className="mx-auto max-w-2xl px-gutter pt-20 pb-12 text-left">
        <motion.div variants={fadeIn} initial="hidden" animate="show">
          <h1 className="font-display text-display font-semibold leading-tight tracking-tight">Basalt CLI</h1>
          <p className="mt-4 text-body text-muted-foreground">
            A small command-line tool for building static sites from plain text.
          </p>
        </motion.div>
      </section>
      <section className="mx-auto max-w-5xl px-gutter pb-20">
        <motion.div variants={fadeInView} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.3 }}>
          <h2 className="text-h2 font-semibold tracking-tight">Write, build, publish</h2>
          <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <Link
              to="/installation"
              className="group block rounded-sm p-4 hover:bg-muted transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <h3 className="text-h3 font-semibold text-primary group-hover:text-foreground">Installation</h3>
              <p className="mt-2 text-body text-muted-foreground">Get Basalt on your machine in under a minute.</p>
            </Link>
            <Link
              to="/quick-start"
              className="group block rounded-sm p-4 hover:bg-muted transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <h3 className="text-h3 font-semibold text-primary group-hover:text-foreground">Quick start</h3>
              <p className="mt-2 text-body text-muted-foreground">
                Build your first site from a directory of Markdown files.
              </p>
            </Link>
            <Link
              to="/commands"
              className="group block rounded-sm p-4 hover:bg-muted transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <h3 className="text-h3 font-semibold text-primary group-hover:text-foreground">Command reference</h3>
              <p className="mt-2 text-body text-muted-foreground">
                Every Basalt command, flag, and exit code, listed.
              </p>
            </Link>
          </div>
        </motion.div>
      </section>
    </>
  );
}
