import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { buttonVariants } from '@/components/ui/button';
import { Reveal } from '@/components/Reveal';
import { categoryLabels, filters, works } from '@/data/works';
import type { CategoryFilter, Work } from '@/data/works';
import { easeOut, press, pressSpring } from '@/lib/motion';
import { cn } from '@/lib/utils';

interface TileLayout {
  span: string;
  aspect: string;
  offset: string;
}

// Unequal spans and offsets on the 12 column grid, so the gallery reads as a
// magazine spread. The pattern repeats for shorter filtered lists.
const tileLayouts: TileLayout[] = [
  { span: 'lg:col-span-7', aspect: 'aspect-[5/4]', offset: '' },
  { span: 'lg:col-span-5', aspect: 'aspect-[4/5]', offset: 'lg:mt-32' },
  { span: 'lg:col-span-4', aspect: 'aspect-[4/5]', offset: '' },
  { span: 'lg:col-span-8', aspect: 'aspect-[16/10]', offset: 'lg:mt-16' },
  { span: 'lg:col-span-5', aspect: 'aspect-[4/5]', offset: '' },
  { span: 'lg:col-span-7', aspect: 'aspect-[5/4]', offset: 'lg:mt-24' },
  { span: 'lg:col-span-6', aspect: 'aspect-square', offset: '' },
  { span: 'lg:col-span-6', aspect: 'aspect-square', offset: 'lg:mt-16' },
];

function worksFor(filter: CategoryFilter): Work[] {
  return filter === 'all' ? works : works.filter((work) => work.category === filter);
}

interface TileProps {
  work: Work;
  index: number;
  onOpen: (id: string) => void;
}

function Tile({ work, index, onOpen }: TileProps) {
  const layout = tileLayouts[index % tileLayouts.length];
  const Art = work.Art;
  return (
    <motion.li
      className={cn(layout.span, layout.offset)}
      style={{ transformOrigin: 'center top' }}
      initial={{ opacity: 0, scale: 0.98 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.5, ease: easeOut, delay: (index % 2) * 0.08 }}
    >
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => onOpen(work.id)}
        className="group block w-full cursor-pointer text-left"
      >
        <span className={cn('relative block overflow-hidden rounded-plate bg-muted', layout.aspect)}>
          <span className="absolute inset-0 transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-[1.02] motion-reduce:transition-none">
            <Art />
          </span>
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 ring-1 ring-foreground/10 ring-inset" />
        </span>
        <span className="mt-3 flex items-start gap-4 border-t border-border pt-3">
          <span className="pt-1 font-mono text-caption text-muted-foreground">{work.plate}</span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-title transition-colors group-hover:text-primary">{work.title}</span>
            <span className="mt-1 block font-mono text-caption text-muted-foreground">
              {categoryLabels[work.category]}, {work.medium}, {work.year}
            </span>
          </span>
          <ArrowUpRight
            aria-hidden="true"
            className="mt-1 size-5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
          />
        </span>
      </button>
    </motion.li>
  );
}

export function Gallery() {
  const [filter, setFilter] = useState<CategoryFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const visible = worksFor(filter);
  const openIndex = visible.findIndex((work) => work.id === openId);
  const current = openIndex >= 0 ? visible[openIndex] : undefined;

  function openWork(id: string) {
    setOpenId(id);
    setOpen(true);
  }

  function step(delta: number) {
    if (openIndex < 0) return;
    const next = visible[(openIndex + delta + visible.length) % visible.length];
    setOpenId(next.id);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      step(1);
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      step(-1);
    }
  }

  return (
    <section id="work" aria-labelledby="work-title" className="page-x mx-auto max-w-page py-20 lg:py-32">
      <div className="grid gap-6 border-t border-foreground pt-6 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <Reveal>
            <p className="font-mono text-label uppercase text-muted-foreground">Selected work</p>
            <h2 id="work-title" className="mt-4 font-display text-headline">
              Eight pictures from the last four years
            </h2>
          </Reveal>
          <p className="mt-6 max-w-[34rem] text-muted-foreground">
            Select any plate to see it larger, with notes on how it was made.
          </p>
        </div>
        <p
          aria-hidden="true"
          className="hidden font-display text-numeral italic text-primary lg:col-span-5 lg:-mt-28 lg:block lg:text-right"
        >
          08
        </p>
      </div>

      <Tabs value={filter} onValueChange={(value) => setFilter(value as CategoryFilter)} className="mt-12 lg:mt-16">
        <TabsList aria-label="Filter plates by kind of work">
          {filters.map((item) => (
            <TabsTrigger key={item.value} value={item.value}>
              {item.label}
              <span className="font-mono text-caption text-muted-foreground">{worksFor(item.value).length}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        {filters.map((item) => (
          <TabsContent key={item.value} value={item.value}>
            <ul className="grid grid-cols-1 items-start gap-x-6 gap-y-14 md:grid-cols-2 lg:grid-cols-12 lg:gap-y-20">
              {worksFor(item.value).map((work, index) => (
                <Tile key={work.id} work={work} index={index} onOpen={openWork} />
              ))}
            </ul>
          </TabsContent>
        ))}
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onKeyDown={handleKeyDown}>
          {current ? (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={current.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: easeOut }}
                className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-10"
              >
                <div className="relative aspect-[4/5] w-full overflow-hidden bg-muted lg:max-h-[calc(100dvh-8rem)]">
                  <div className="absolute inset-0">
                    <current.Art />
                  </div>
                </div>
                <div className="flex flex-col lg:pt-10">
                  <p className="font-mono text-label uppercase text-muted-foreground">Plate {current.plate}</p>
                  <DialogTitle className="mt-3 text-headline">{current.title}</DialogTitle>
                  <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-4">
                    <div>
                      <dt className="font-mono text-label uppercase text-muted-foreground">Medium</dt>
                      <dd className="mt-1 text-base">{current.medium}</dd>
                    </div>
                    <div>
                      <dt className="font-mono text-label uppercase text-muted-foreground">Size</dt>
                      <dd className="mt-1 text-base">{current.size}</dd>
                    </div>
                    <div>
                      <dt className="font-mono text-label uppercase text-muted-foreground">Year</dt>
                      <dd className="mt-1 text-base">{current.year}</dd>
                    </div>
                    <div>
                      <dt className="font-mono text-label uppercase text-muted-foreground">Filed under</dt>
                      <dd className="mt-1 text-base">{categoryLabels[current.category]}</dd>
                    </div>
                  </dl>
                  <DialogDescription className="mt-6 text-body text-foreground">{current.note}</DialogDescription>
                  <div className="mt-auto flex flex-wrap items-center gap-3 pt-8">
                    <motion.button
                      type="button"
                      onClick={() => step(-1)}
                      whileTap={press}
                      transition={pressSpring}
                      className={buttonVariants({ variant: 'outline' })}
                    >
                      <ChevronLeft aria-hidden="true" />
                      Previous
                    </motion.button>
                    <motion.button
                      type="button"
                      onClick={() => step(1)}
                      whileTap={press}
                      transition={pressSpring}
                      className={buttonVariants({ variant: 'outline' })}
                    >
                      Next
                      <ChevronRight aria-hidden="true" />
                    </motion.button>
                    <p className="ml-auto font-mono text-caption text-muted-foreground" aria-live="polite">
                      {openIndex + 1} of {visible.length}
                    </p>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          ) : (
            <DialogTitle className="sr-only">Plate</DialogTitle>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
