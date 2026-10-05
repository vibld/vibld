import { useState } from 'react';
import type { FormEvent } from 'react';
import { motion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { fadeUp, staggerContainer } from '@/lib/motion';

export default function ContactPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setSuccess(false);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    setLoading(false);
    setSuccess(true);
    setName('');
    setEmail('');
    setCompany('');
    setMessage('');
  };

  return (
    <>
      <PageHeader
        eyebrow="Contact"
        title="Start a conversation"
        intro="Tell us what is keeping you up at night. We will ask questions, not pitch. Expect a reply within two business days."
      />
      <section className="mx-auto max-w-2xl px-4 pb-20 sm:px-6 lg:px-8 lg:pb-28">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
          className="rounded-lg border border-border bg-card p-6 shadow-sm sm:p-8"
        >
          {success && (
            <motion.div variants={fadeUp} role="status" className="mb-6 rounded-md bg-secondary/60 p-4 text-sm text-secondary-foreground">
              Message sent. This is a demonstration, so no email left your browser. We would reply within two business days.
            </motion.div>
          )}
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Your name</Label>
              <Input
                id="name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Jane Smith"
                autoComplete="name"
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="jane@company.com"
                autoComplete="email"
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="company">Company</Label>
              <Input
                id="company"
                type="text"
                value={company}
                onChange={(event) => setCompany(event.target.value)}
                placeholder="Company name"
                autoComplete="organization"
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="message">What would you like to discuss?</Label>
              <Textarea
                id="message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="A few sentences about your situation is enough."
                rows={5}
                required
                disabled={loading}
              />
            </div>
            <motion.div variants={fadeUp}>
              <Button type="submit" size="lg" disabled={loading} className="w-full sm:w-auto">
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                    Sending...
                  </>
                ) : (
                  'Send message'
                )}
              </Button>
            </motion.div>
          </form>
          <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
            This form is a demonstration and does not send messages.
          </p>
        </motion.div>
      </section>
    </>
  );
}
