type SectionHeadingProps = {
  kicker: string;
  heading: string;
  intro?: string;
};

export default function SectionHeading({ kicker, heading, intro }: SectionHeadingProps) {
  return (
    <div className="mb-12 md:mb-16">
      <p className="mb-3 text-small text-muted-foreground">{kicker}</p>
      <h2 className="font-display text-h2 text-foreground text-wrap-balance">{heading}</h2>
      {intro && (
        <p className="mt-4 max-w-2xl text-body text-muted-foreground text-wrap-pretty">
          {intro}
        </p>
      )}
    </div>
  );
}
