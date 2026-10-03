import { motion } from 'motion/react';
import { PageSection } from '@/components/PageSection';
import { Button } from '@/components/ui/Button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/Card';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/Dialog';
import { staggerContainer, fadeUp } from '@/lib/motion';

const tickets = [
  {
    name: 'Day pass',
    description: 'Entry for one day, all demos and workshops, and a tasting token.',
    price: '$45',
  },
  {
    name: 'Weekend pass',
    description: 'Both days, the long table dinner, and a festival tote.',
    price: '$85',
  },
  {
    name: 'Fire table seat',
    description: 'Reserved seat at the long table dinner plus weekend entry.',
    price: '$120',
  },
];

export function TicketsSection() {
  return (
    <PageSection
      id="tickets"
      heading="Tickets"
      intro="Buy a day pass or the whole weekend. All tickets are a demonstration; no payment is taken."
    >
      <Dialog>
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.3 }}
          className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
        >
          {tickets.map((ticket) => (
            <motion.div key={ticket.name} variants={fadeUp}>
              <Card className="flex h-full flex-col">
                <CardHeader>
                  <CardTitle>{ticket.name}</CardTitle>
                  <CardDescription>{ticket.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex-1">
                  <p className="font-display text-4xl font-semibold text-primary">{ticket.price}</p>
                </CardContent>
                <CardFooter>
                  <DialogTrigger asChild>
                    <Button className="w-full">Select</Button>
                  </DialogTrigger>
                </CardFooter>
              </Card>
            </motion.div>
          ))}
        </motion.div>

        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tickets are a demonstration</DialogTitle>
            <DialogDescription>
              No payment is collected and no tickets are issued. This site shows how the festival
              would sell entry.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageSection>
  );
}

export default TicketsSection;
