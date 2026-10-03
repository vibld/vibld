import { useState } from 'react';
import { motion } from 'motion/react';
import { Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buttonVariants, Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
  SheetClose,
} from '@/components/ui/sheet';
import { materializeGlass } from '@/lib/motion';

export default function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <motion.header
      variants={materializeGlass}
      initial="hidden"
      animate="show"
      className="fixed inset-x-0 top-0 z-50 h-18 backdrop-blur-lg backdrop-saturate-150 bg-glass-bg border-b border-glass-border"
    >
      <div className="mx-auto flex h-full max-w-[1200px] items-center justify-between px-[clamp(20px,4vw,48px)]">
        <a href="#hero" className="font-display text-lg font-semibold text-foreground tracking-tight">
          Mara Voss
        </a>

        <nav className="hidden sm:flex items-center gap-6">
          <a href="#gallery" className="text-sm font-medium text-foreground transition-colors hover:text-primary">
            Work
          </a>
          <a href="#bio" className="text-sm font-medium text-foreground transition-colors hover:text-primary">
            About
          </a>
          <a href="#contact" className="text-sm font-medium text-foreground transition-colors hover:text-primary">
            Contact
          </a>
        </nav>

        <div className="hidden sm:block">
          <a href="#contact" className={cn(buttonVariants({ variant: 'default', size: 'sm' }))}>
            Book a shoot
          </a>
        </div>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="sm:hidden" aria-label="Open navigation">
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="bg-background p-0">
            <SheetHeader className="p-6">
              <SheetTitle className="font-display text-xl font-semibold">Mara Voss</SheetTitle>
              <SheetDescription className="sr-only">Site navigation links</SheetDescription>
            </SheetHeader>
            <nav className="flex flex-col gap-2 px-6 pb-6">
              <SheetClose asChild>
                <a href="#gallery" className="rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors">
                  Work
                </a>
              </SheetClose>
              <SheetClose asChild>
                <a href="#bio" className="rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors">
                  About
                </a>
              </SheetClose>
              <SheetClose asChild>
                <a href="#contact" className="rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors">
                  Contact
                </a>
              </SheetClose>
              <SheetClose asChild>
                <a href="#contact" className={cn(buttonVariants({ variant: 'default', size: 'sm', className: 'mt-2 w-full' }))}>
                  Book a shoot
                </a>
              </SheetClose>
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </motion.header>
  );
}
