import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface CaseStudyCardProps {
  client: string;
  title: string;
  outcome: string;
}

export default function CaseStudyCard({
  client,
  title,
  outcome,
}: CaseStudyCardProps) {
  return (
    <Card className="transition-all duration-150 ease-out hover:-translate-y-0.5 hover:bg-secondary hover:border-muted-foreground/30">
      <CardHeader>
        <p className="text-sm uppercase tracking-wider text-muted-foreground">
          {client}
        </p>
        <CardTitle className="text-xl">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">{outcome}</p>
      </CardContent>
    </Card>
  );
}
