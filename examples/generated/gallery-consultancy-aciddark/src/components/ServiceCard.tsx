import { Card } from "@/components/ui/card";

interface ServiceCardProps {
  title: string;
  description: string;
}

export default function ServiceCard({ title, description }: ServiceCardProps) {
  return (
    <Card className="p-6 transition-all duration-150 ease-out hover:-translate-y-0.5 hover:bg-secondary hover:border-muted-foreground/30">
      <h3 className="font-display text-xl font-semibold text-foreground">
        {title}
      </h3>
      <p className="mt-2 text-muted-foreground">{description}</p>
    </Card>
  );
}
