import { motion } from 'motion/react';
import { PageHeader } from '@/components/PageHeader';
import { fadeScale, clipWipe } from '@/lib/motion';

interface Participant {
  name: string;
  role: string;
  description: string;
}

const fire: Participant[] = [
  { name: 'Ana Reyes', role: 'Pitmaster', description: 'Cooks whole animals over oak and cherry at her Portland restaurant, Brasa.' },
  { name: 'The Beekman Family', role: 'Whole-animal barbecue', description: 'Three generations of the Beekman family, known for their beef ribs and vinegar sauces.' },
  { name: 'Jonah Vale', role: 'Open-fire cook', description: 'Brings a traveling hearth and a quiet obsession with ember-roasted root vegetables.' },
  { name: 'Marta Kowalski', role: 'Flame and vegetable cook', description: 'Turns whole brassicas and winter squash into charred, smoky centerpieces.' },
  { name: 'Diego Fuentes', role: 'Spit-roast specialist', description: 'Slow-rotates lamb and goat over live fire, basting with wild herbs.' },
];

const pastry: Participant[] = [
  { name: 'Marcus Chen', role: 'Pastry chef', description: 'Known for laminated doughs and a brown butter financier that sells out by noon.' },
  { name: 'Sophie Liu', role: 'Baker', description: 'Bakes naturally leavened loaves and buckwheat galettes in a wood-fired oven.' },
  { name: 'Eli Sorenson', role: 'Chocolatier', description: 'Makes single-origin chocolate bars and bonbons with Pacific Northwest hazelnuts.' },
];

const ferments: Participant[] = [
  { name: 'Lena Ortiz', role: 'Fermenter and preservationist', description: 'Keeps a library of wild ferments, from lacto blueberries to smoked miso.' },
  { name: 'Yuki Tanaka', role: 'Koji and miso maker', description: 'Grows koji on local barley and rice for miso, shoyu, and garum.' },
  { name: 'Samir Patel', role: 'Pickler and preserver', description: 'Puts up jars of spiced peaches, bread-and-butter cucumbers, and green tomato chutney.' },
];

const drinks: Participant[] = [
  { name: 'Naomi Harper', role: 'Natural winemaker', description: 'Pours low-intervention wines from her small vineyard in the Willamette Valley.' },
  { name: 'Tomas Rivera', role: 'Coffee roaster and cacao maker', description: 'Roasts coffee over a wood fire and grinds cacao for drinking chocolate.' },
];

const categories = [
  { title: 'Fire', participants: fire },
  { title: 'Pastry', participants: pastry },
  { title: 'Ferments', participants: ferments },
  { title: 'Drinks', participants: drinks },
];

export default function Lineup() {
  return (
    <>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <PageHeader
          kicker="The lineup"
          title="Chefs, makers and fire tenders"
          lead="Forty Northwest cooks, bakers and beverage makers across four days of demos and dinners."
        />
      </div>
      <motion.div
        variants={clipWipe}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.3 }}
        className="mb-16 w-full overflow-hidden md:mb-24"
      >
        <img
          src="https://images.unsplash.com/photo-1555939594-58d7cb561ad1?q=80&w=2000&auto=format&fit=crop"
          alt="A long table filled with food and people at an outdoor festival"
          className="h-[50vh] w-full object-cover md:h-[70vh]"
        />
      </motion.div>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="space-y-16 md:space-y-24">
          {categories.map((category) => (
            <section key={category.title} aria-labelledby={`${category.title.toLowerCase()}-heading`}>
              <h2 id={`${category.title.toLowerCase()}-heading`} className="font-display text-3xl tracking-tight md:text-4xl">
                {category.title}
              </h2>
              <div className="mt-8 grid grid-cols-1 gap-x-8 gap-y-12 md:grid-cols-2 lg:grid-cols-3">
                {category.participants.map((person) => (
                  <motion.article
                    key={person.name}
                    variants={fadeScale}
                    initial="hidden"
                    whileInView="show"
                    viewport={{ once: true, amount: 0.3 }}
                    className="group"
                  >
                    <h3 className="font-display text-xl leading-snug tracking-tight">{person.name}</h3>
                    <p className="mt-1 text-sm uppercase tracking-[0.15em] text-muted-foreground">{person.role}</p>
                    <p className="mt-3 leading-relaxed text-muted-foreground">{person.description}</p>
                  </motion.article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
