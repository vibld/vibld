import { useState } from "react";
import type { FormEvent } from "react";
import { motion } from "motion/react";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import SectionHeading from "@/components/SectionHeading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { fadeUp } from "@/lib/motion";

interface FormState {
  name: string;
  email: string;
  message: string;
}

interface FormErrors {
  name?: string;
  email?: string;
  message?: string;
}

export default function Contact() {
  const [form, setForm] = useState<FormState>({
    name: "",
    email: "",
    message: "",
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const validate = (values: FormState): FormErrors => {
    const nextErrors: FormErrors = {};

    if (!values.name.trim()) {
      nextErrors.name = "Name is required.";
    }

    if (!values.email.trim()) {
      nextErrors.email = "Email is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
      nextErrors.email = "Enter a valid email address.";
    }

    if (!values.message.trim()) {
      nextErrors.message = "Message is required.";
    }

    return nextErrors;
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const nextErrors = validate(form);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setSubmitting(true);
    setSubmitted(false);

    // Demonstration only: no backend, so this resolves locally.
    await new Promise((resolve) => setTimeout(resolve, 800));

    setSubmitting(false);
    setSubmitted(true);
  };

  return (
    <>
      <SiteHeader />
      <main>
        <section className="mx-auto max-w-[720px] px-6 py-[clamp(4rem,10vw,8rem)]">
          <SectionHeading
            align="center"
            eyebrow="Contact"
            title="Talk to us"
            description="Tell us what you are trying to solve. We will reply within one business day."
          />

          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            className="rounded-md border border-border bg-card p-8"
          >
            <p className="mb-8 text-sm text-muted-foreground">
              This form is a demonstration and does not send.
            </p>

            <form onSubmit={handleSubmit} noValidate className="space-y-6">
              <div>
                <Label htmlFor="name" className="mb-2 block text-foreground">
                  Name
                </Label>
                <Input
                  id="name"
                  name="name"
                  type="text"
                  value={form.name}
                  onChange={handleChange}
                  disabled={submitting || submitted}
                  aria-required="true"
                  aria-invalid={!!errors.name}
                  aria-describedby={errors.name ? "name-error" : undefined}
                  className={errors.name ? "border-destructive" : ""}
                />
                {errors.name && (
                  <p
                    id="name-error"
                    className="mt-2 flex items-center gap-1.5 text-sm text-destructive"
                  >
                    <AlertCircle className="h-4 w-4" aria-hidden="true" />
                    {errors.name}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="email" className="mb-2 block text-foreground">
                  Email
                </Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleChange}
                  disabled={submitting || submitted}
                  aria-required="true"
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? "email-error" : undefined}
                  className={errors.email ? "border-destructive" : ""}
                />
                {errors.email && (
                  <p
                    id="email-error"
                    className="mt-2 flex items-center gap-1.5 text-sm text-destructive"
                  >
                    <AlertCircle className="h-4 w-4" aria-hidden="true" />
                    {errors.email}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="message" className="mb-2 block text-foreground">
                  Message
                </Label>
                <Textarea
                  id="message"
                  name="message"
                  value={form.message}
                  onChange={handleChange}
                  disabled={submitting || submitted}
                  aria-required="true"
                  aria-invalid={!!errors.message}
                  aria-describedby={errors.message ? "message-error" : undefined}
                  className={errors.message ? "border-destructive" : ""}
                />
                {errors.message && (
                  <p
                    id="message-error"
                    className="mt-2 flex items-center gap-1.5 text-sm text-destructive"
                  >
                    <AlertCircle className="h-4 w-4" aria-hidden="true" />
                    {errors.message}
                  </p>
                )}
              </div>

              <Button
                type="submit"
                size="lg"
                disabled={submitting || submitted}
                className="w-full"
              >
                {submitting ? (
                  <>
                    <Loader2
                      className="h-4 w-4 animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                    Sending...
                  </>
                ) : submitted ? (
                  <>
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    Message sent
                  </>
                ) : (
                  "Send message"
                )}
              </Button>
            </form>

            {submitted && (
              <div
                role="status"
                className="mt-6 flex items-start gap-3 rounded-md border border-border bg-background p-4 text-sm text-muted-foreground"
              >
                <CheckCircle2
                  className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <p>
                  Thanks. This form is a demonstration, so nothing was sent.
                </p>
              </div>
            )}
          </motion.div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
