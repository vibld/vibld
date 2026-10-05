import { useState } from "react";
import type { FormEvent } from "react";
import { Check, Loader2 } from "lucide-react";
import { GlassPanel } from "@/components/GlassPanel";
import { Button } from "@/components/ui/button";

const ticketOptions = [
  {
    title: "Weekend pass",
    price: "$45",
    description: "Entry both days, every cooking demo, and evening music.",
    highlight: true,
  },
  {
    title: "Single day pass",
    price: "$25",
    description: "Choose Saturday or Sunday. Gate price is $35 after May 15.",
    highlight: false,
  },
  {
    title: "Kids under 12",
    price: "Free",
    description: "No ticket needed. One adult can bring up to three kids.",
    highlight: false,
  },
];

const faqs = [
  {
    question: "Can I buy tickets at the gate?",
    answer:
      "A limited number of single day passes are available at the gate for $35. Weekend passes usually sell out before the event, so buy early.",
  },
  {
    question: "Do kids need a ticket?",
    answer:
      "Kids under 12 enter free with an adult. You do not need to reserve a separate ticket for them.",
  },
  {
    question: "What if it rains?",
    answer:
      "The festival is outside. Most vendor stalls and stages are covered, but bring a raincoat and wear shoes that can handle wet bricks.",
  },
  {
    question: "Are tickets refundable?",
    answer:
      "Tickets are non-refundable, but you can transfer them to another name until June 10 by replying to your confirmation email.",
  },
];

export default function Tickets() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    ticket: "weekend",
    quantity: "1",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "loading" | "success">("idle");

  const updateField = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const validate = () => {
    const nextErrors: Record<string, string> = {};
    if (!form.name.trim()) nextErrors.name = "Name is required.";
    if (!form.email.trim()) {
      nextErrors.email = "Email is required.";
    } else if (!/^\S+@\S+\.\S+$/.test(form.email)) {
      nextErrors.email = "Enter a valid email address.";
    }
    return nextErrors;
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const validationErrors = validate();
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length === 0) {
      setStatus("loading");
      window.setTimeout(() => {
        setStatus("success");
      }, 1200);
    }
  };

  return (
    <section className="mx-auto max-w-7xl px-4 py-[clamp(3rem,8vw,6rem)] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="font-display text-4xl text-foreground md:text-5xl">Tickets</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Choose your pass and join us June 14-15, 2025 at Pioneer Courthouse Square.
        </p>
      </div>

      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {ticketOptions.map((option) => (
          <GlassPanel
            key={option.title}
            className={`p-6 ${option.highlight ? "md:-translate-y-2" : ""}`}
          >
            <div className="flex flex-col gap-3">
              <h2 className="font-display text-xl text-foreground">{option.title}</h2>
              <p className="text-3xl font-semibold text-foreground">{option.price}</p>
              <p className="text-sm text-muted-foreground">{option.description}</p>
            </div>
          </GlassPanel>
        ))}
      </div>

      <div className="mt-16 grid gap-8 lg:grid-cols-2">
        <GlassPanel className="p-6 md:p-10">
          <h2 className="font-display text-2xl text-foreground md:text-3xl">Reserve your pass</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            This form is a demonstration and does not process payments or reserve tickets.
          </p>

          {status === "success" ? (
            <div
              role="status"
              className="mt-6 flex items-start gap-3 rounded-md border border-glass-border bg-background/80 p-4"
            >
              <Check className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <p className="font-semibold text-foreground">
                  Thanks, {form.name.trim() || "friend"}.
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  This is a demonstration, so no payment was processed. We will email details to{" "}
                  {form.email.trim()}.
                </p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-5" noValidate>
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor="ticket-name" className="mb-2 block text-sm font-semibold text-foreground">
                    Name
                  </label>
                  <input
                    id="ticket-name"
                    type="text"
                    autoComplete="name"
                    value={form.name}
                    onChange={(event) => updateField("name", event.target.value)}
                    className="w-full rounded-md border border-border bg-background/70 px-4 py-3 text-foreground placeholder:text-muted-foreground/60 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
                  />
                  {errors.name && (
                    <p className="mt-2 text-sm text-primary" role="alert">
                      {errors.name}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="ticket-email" className="mb-2 block text-sm font-semibold text-foreground">
                    Email
                  </label>
                  <input
                    id="ticket-email"
                    type="email"
                    autoComplete="email"
                    value={form.email}
                    onChange={(event) => updateField("email", event.target.value)}
                    className="w-full rounded-md border border-border bg-background/70 px-4 py-3 text-foreground placeholder:text-muted-foreground/60 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
                  />
                  {errors.email && (
                    <p className="mt-2 text-sm text-primary" role="alert">
                      {errors.email}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor="ticket-type" className="mb-2 block text-sm font-semibold text-foreground">
                    Pass type
                  </label>
                  <select
                    id="ticket-type"
                    value={form.ticket}
                    onChange={(event) => updateField("ticket", event.target.value)}
                    className="w-full rounded-md border border-border bg-background/70 px-4 py-3 text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
                  >
                    <option value="weekend">Weekend pass, $45</option>
                    <option value="saturday">Saturday only, $25</option>
                    <option value="sunday">Sunday only, $25</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="ticket-quantity" className="mb-2 block text-sm font-semibold text-foreground">
                    Quantity
                  </label>
                  <select
                    id="ticket-quantity"
                    value={form.quantity}
                    onChange={(event) => updateField("quantity", event.target.value)}
                    className="w-full rounded-md border border-border bg-background/70 px-4 py-3 text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
                  >
                    {["1", "2", "3", "4", "5", "6"].map((number) => (
                      <option key={number} value={number}>
                        {number}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <Button
                type="submit"
                size="lg"
                disabled={status === "loading"}
                className="w-full sm:w-auto"
              >
                {status === "loading" && <Loader2 className="size-4 animate-spin" />}
                {status === "loading" ? "Reserving..." : "Reserve tickets"}
              </Button>
            </form>
          )}
        </GlassPanel>

        <GlassPanel className="p-6 md:p-10">
          <h2 className="font-display text-2xl text-foreground md:text-3xl">Ticket questions</h2>
          <div className="mt-6 space-y-6">
            {faqs.map((faq) => (
              <div key={faq.question} className="rounded-md border border-glass-border bg-background/80 p-4">
                <h3 className="text-base font-semibold text-foreground">{faq.question}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{faq.answer}</p>
              </div>
            ))}
          </div>
        </GlassPanel>
      </div>
    </section>
  );
}
