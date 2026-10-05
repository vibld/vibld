import { motion, type Variants } from "motion/react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { GlassPanel } from "@/components/GlassPanel";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { staggerContainer } from "@/lib/motion";

const rise: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 120, damping: 20 } },
};

const previewVendors = [
  { name: "Smoke & Ember BBQ", description: "Slow-smoked brisket and maple bourbon glaze." },
  { name: "Curry Up Now", description: "Indian street food with a Pacific Northwest twist." },
  { name: "Sweet & Glazed", description: "Handcrafted doughnuts and seasonal fruit fillings." },
];

const schedulePreview = [
  { time: "Sat 11:00 AM", event: "Opening ceremony & chef welcome" },
  { time: "Sat 2:00 PM", event: "Live fire cooking demo" },
  { time: "Sun 1:00 PM", event: "Chili cook-off finals" },
];

export default function Home() {
  return (
    <>
      <section className="relative flex min-h-svh items-center justify-center overflow-hidden px-4 py-24">
        <div aria-hidden className="absolute inset-0 -z-10">
          <div className="absolute -top-32 -left-32 size-96 rounded-full bg-primary/30 blur-3xl" />
          <div className="absolute top-1/2 right-0 size-96 translate-x-1/2 rounded-full bg-accent/20 blur-3xl" />
          <div className="absolute bottom-0 left-1/3 size-96 rounded-full bg-primary/20 blur-3xl" />
        </div>
        <GlassPanel className="mx-auto w-full max-w-3xl px-6 py-10 text-center md:px-12 md:py-16">
          <motion.div variants={staggerContainer} initial="hidden" animate="show">
            <motion.h1 variants={rise} className="font-display text-4xl text-foreground sm:text-5xl md:text-6xl lg:text-7xl">
              Fork &amp; Flame Weekend
            </motion.h1>
            <motion.p variants={rise} className="mt-4 text-lg text-muted-foreground md:text-xl">
              Two days of flavor, fire, and community.
            </motion.p>
            <motion.p variants={rise} className="mt-2 text-sm text-muted-foreground/80">
              June 14-15, 2025 · Downtown Portland
            </motion.p>
            <motion.div variants={rise} className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Button asChild size="lg">
                <Link to="/tickets">Get tickets</Link>
              </Button>
              <Button asChild variant="link" size="lg">
                <Link to="/lineup" className="gap-1">
                  See lineup <ArrowRight className="size-4" />
                </Link>
              </Button>
            </motion.div>
          </motion.div>
        </GlassPanel>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-[clamp(3rem,8vw,6rem)] sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl text-foreground md:text-4xl">Taste the lineup</h2>
          <p className="mt-3 text-muted-foreground">Over 40 vendors serving street food, craft drinks, and dessert.</p>
        </div>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {previewVendors.map((vendor) => (
            <GlassPanel key={vendor.name} className="p-6">
              <Card className="border-0 bg-transparent">
                <CardHeader className="p-0">
                  <CardTitle className="font-display text-xl text-foreground">{vendor.name}</CardTitle>
                  <CardDescription className="mt-2 text-muted-foreground">{vendor.description}</CardDescription>
                </CardHeader>
              </Card>
            </GlassPanel>
          ))}
        </div>
        <div className="mt-8 text-center">
          <Button asChild variant="link">
            <Link to="/lineup" className="gap-1">
              Full lineup <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 py-[clamp(3rem,8vw,6rem)] sm:px-6 lg:px-8">
        <GlassPanel className="p-6 md:p-10">
          <h2 className="font-display text-3xl text-foreground md:text-4xl">Two days of flavor</h2>
          <p className="mt-3 text-muted-foreground">From live cooking demos to late-night bites.</p>
          <ul className="mt-8 divide-y divide-border">
            {schedulePreview.map((item) => (
              <li key={`${item.time}-${item.event}`} className="flex flex-col gap-1 py-4 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm font-semibold text-accent">{item.time}</span>
                <span className="text-muted-foreground">{item.event}</span>
              </li>
            ))}
          </ul>
          <div className="mt-8 text-center">
            <Button asChild variant="link">
              <Link to="/schedule" className="gap-1">
                Full schedule <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </GlassPanel>
      </section>

      <section className="mx-auto max-w-2xl px-4 py-[clamp(3rem,8vw,6rem)] sm:px-6 lg:px-8">
        <GlassPanel className="p-6 text-center md:p-10">
          <h2 className="font-display text-3xl text-foreground md:text-4xl">Join the feast</h2>
          <p className="mt-3 text-muted-foreground">Early bird tickets available until May 15.</p>
          <p className="mt-4 text-3xl font-semibold text-foreground">$45 weekend pass</p>
          <div className="mt-8 flex flex-col items-center gap-4">
            <Button asChild size="lg">
              <Link to="/tickets">Buy tickets</Link>
            </Button>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">Kids under 12 free with adult</p>
        </GlassPanel>
      </section>

      <section className="mx-auto max-w-4xl px-4 py-[clamp(3rem,8vw,6rem)] sm:px-6 lg:px-8">
        <GlassPanel className="p-6 text-center md:p-10">
          <h2 className="font-display text-3xl text-foreground md:text-4xl">Get there</h2>
          <p className="mt-3 text-muted-foreground">Pioneer Courthouse Square, 701 SW 6th Ave, Portland, OR</p>
          <div className="mt-8">
            <Button asChild variant="link">
              <Link to="/directions" className="gap-1">
                Directions &amp; parking <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </GlassPanel>
      </section>
    </>
  );
}
