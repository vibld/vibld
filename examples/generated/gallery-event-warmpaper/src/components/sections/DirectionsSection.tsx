import { PageSection } from '@/components/PageSection';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';

export function DirectionsSection() {
  return (
    <PageSection id="directions" heading="Directions" intro="">
      <div className="grid gap-10 md:grid-cols-2 md:gap-16">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Address</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-base leading-relaxed text-card-foreground">
              Riverside Park, 1200 River Road, Millerton, NY 12546
            </p>
          </CardContent>
        </Card>

        <div className="space-y-8">
          <div>
            <h3 className="font-display text-xl font-semibold tracking-tight text-foreground">
              By train
            </h3>
            <p className="mt-2 text-base leading-relaxed text-muted-foreground">
              Metro-North to Wassaic, then the free festival shuttle runs every 20 minutes from 9am to
              11pm.
            </p>
          </div>
          <div>
            <h3 className="font-display text-xl font-semibold tracking-tight text-foreground">
              By car
            </h3>
            <p className="mt-2 text-base leading-relaxed text-muted-foreground">
              Route 22 to River Road; parking is at the north meadow, a 10-minute walk from the gate.
            </p>
          </div>
          <div>
            <h3 className="font-display text-xl font-semibold tracking-tight text-foreground">
              By bike
            </h3>
            <p className="mt-2 text-base leading-relaxed text-muted-foreground">
              The Hudson Valley Rail Trail ends at the park entrance; bike racks are inside the gate.
            </p>
          </div>
        </div>
      </div>
    </PageSection>
  );
}

export default DirectionsSection;
