import { Bus, Car, Bike, MapPin } from "lucide-react";
import { GlassPanel } from "@/components/GlassPanel";

const travelDetails = [
  {
    icon: Bus,
    title: "Public transit",
    body: "MAX light rail stops at Pioneer Square North and South, one block from the square. Bus routes 6, 10, 14, 19, 54, and 99 stop within two blocks.",
  },
  {
    icon: Car,
    title: "Parking",
    body: "SmartPark garages on SW 3rd and SW 10th offer a weekend rate of $5 all day until 6 PM. Street parking is metered until 7 PM.",
  },
  {
    icon: Bike,
    title: "Bike parking",
    body: "Covered bike racks are at SW Yamhill and SW Broadway, directly across from the square. Biketown stations are one block east on SW 6th.",
  },
];

export default function Directions() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-[clamp(3rem,8vw,6rem)] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="font-display text-4xl text-foreground md:text-5xl">Get there</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Pioneer Courthouse Square, 701 SW 6th Ave, Portland, OR.
        </p>
      </div>

      <GlassPanel className="mx-auto mt-12 max-w-5xl p-6 md:p-8">
        <div className="overflow-hidden rounded-md border border-glass-border">
          <iframe
            title="Map of Pioneer Courthouse Square"
            src="https://www.openstreetmap.org/export/embed.html?bbox=-122.690%2C45.510%2C-122.670%2C45.530&layer=mapnik&marker=45.519%2C-122.680"
            className="h-72 w-full md:h-96"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>

        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {travelDetails.map((detail) => (
            <div
              key={detail.title}
              className="rounded-md border border-glass-border bg-background/80 p-5"
            >
              <div className="flex items-center gap-3">
                <detail.icon className="size-5 shrink-0 text-accent" />
                <h2 className="text-base font-semibold text-foreground">{detail.title}</h2>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{detail.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 flex items-start gap-3 rounded-md border border-glass-border bg-background/80 p-5">
          <MapPin className="mt-0.5 size-5 shrink-0 text-primary" />
          <p className="text-sm text-muted-foreground">
            The main entrance is on SW 6th Ave, between SW Morrison and SW Yamhill. Look for the
            festival banners above the square steps.
          </p>
        </div>
      </GlassPanel>
    </section>
  );
}
