import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, MapPin } from "lucide-react";
import { GlassPanel } from "@/components/GlassPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type ScheduleItem = {
  time: string;
  event: string;
  location: string;
  description: string;
};

const saturday: ScheduleItem[] = [
  {
    time: "11:00 AM",
    event: "Opening ceremony & chef welcome",
    location: "Main Stage",
    description: "Kick off the weekend with a few words from our head chefs and a sample of what is to come.",
  },
  {
    time: "12:30 PM",
    event: "Live fire cooking demo",
    location: "Fire Pit",
    description: "Watch whole-animal butchery and open-fire cooking with the Smoke & Ember team.",
  },
  {
    time: "2:00 PM",
    event: "Chili cook-off prelims",
    location: "Tasting Tent",
    description: "Eight chefs compete for a spot in Sunday's finals. Tasting cups available.",
  },
  {
    time: "4:00 PM",
    event: "Craft beer pairing",
    location: "Brew Garden",
    description: "Local brewers pour alongside small plates from three festival vendors.",
  },
  {
    time: "6:30 PM",
    event: "Evening street food crawl",
    location: "Vendor Row",
    description: "Grab a bite from any stall and find a seat by the main stage.",
  },
  {
    time: "9:00 PM",
    event: "Dessert after dark",
    location: "Sweet Spot",
    description: "Late-night doughnuts, churros, and gelato until the lights dim.",
  },
];

const sunday: ScheduleItem[] = [
  {
    time: "10:00 AM",
    event: "Brunch bites & coffee",
    location: "Main Square",
    description: "Start Sunday with breakfast tacos, waffles, and pour-over coffee.",
  },
  {
    time: "12:00 PM",
    event: "Chili cook-off finals",
    location: "Tasting Tent",
    description: "The top three chefs go head to head. Winner announced at closing.",
  },
  {
    time: "1:00 PM",
    event: "Family cooking class",
    location: "Kids Zone",
    description: "A hands-on pasta class for families with kids ages 6 and up.",
  },
  {
    time: "3:00 PM",
    event: "Fermentation workshop",
    location: "Workshop Tent",
    description: "Learn to make kimchi and sauerkraut with the team from Driftwood Oysters.",
  },
  {
    time: "5:00 PM",
    event: "Live music & bites",
    location: "Main Stage",
    description: "Portland bands play while the vendors serve their final plates.",
  },
  {
    time: "7:00 PM",
    event: "Closing ceremony",
    location: "Main Stage",
    description: "Thanks, awards, and one last toast to the weekend.",
  },
];

export default function Schedule() {
  const [day, setDay] = useState<"saturday" | "sunday">("saturday");
  const items = day === "saturday" ? saturday : sunday;

  return (
    <section className="mx-auto max-w-4xl px-4 py-[clamp(3rem,8vw,6rem)] sm:px-6 lg:px-8">
      <div className="text-center">
        <h1 className="font-display text-4xl text-foreground md:text-5xl">Schedule</h1>
        <p className="mt-4 text-lg text-muted-foreground">Two days of flavor, fire, and community.</p>
      </div>
      <div className="mt-8 flex justify-center gap-4">
        <Button
          variant={day === "saturday" ? "default" : "outline"}
          onClick={() => setDay("saturday")}
          aria-pressed={day === "saturday"}
          className={day === "saturday" ? undefined : "text-foreground"}
        >
          Saturday
        </Button>
        <Button
          variant={day === "sunday" ? "default" : "outline"}
          onClick={() => setDay("sunday")}
          aria-pressed={day === "sunday"}
          className={day === "sunday" ? undefined : "text-foreground"}
        >
          Sunday
        </Button>
      </div>
      <GlassPanel className="mt-8 p-6 md:p-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={day}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
          >
            <div className="mb-6 flex items-center gap-2 text-muted-foreground">
              <CalendarDays className="size-5 text-accent" />
              <span className="font-semibold text-foreground">
                {day === "saturday" ? "Saturday, June 14" : "Sunday, June 15"}
              </span>
            </div>
            <ul className="space-y-4">
              {items.map((item) => (
                <li key={`${item.time}-${item.event}`}>
                  <Card className="border-glass-border bg-background/80">
                    <CardHeader className="flex flex-row items-start justify-between gap-4 p-4 md:p-6">
                      <div>
                        <CardTitle className="text-lg text-foreground">{item.event}</CardTitle>
                        <CardDescription className="mt-1 text-muted-foreground">{item.description}</CardDescription>
                      </div>
                      <span className="shrink-0 text-sm font-semibold text-accent">{item.time}</span>
                    </CardHeader>
                    <CardContent className="flex items-center gap-2 p-4 pt-0 text-sm text-muted-foreground md:px-6 md:pb-6">
                      <MapPin className="size-4 text-primary" />
                      {item.location}
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          </motion.div>
        </AnimatePresence>
      </GlassPanel>
    </section>
  );
}
