import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, ChevronLeft, ChevronRight, Download, LockKeyhole, Plus, ReceiptText, Trash2, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const STORAGE_KEY = 'tally.entries.v1';

type EntryKind = 'income' | 'expense';
type Entry = { id: string; kind: EntryKind; amount: number; category: string; date: string };
type FieldErrors = Partial<Record<'amount' | 'category' | 'date', string>>;

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const formatMoney = (amount: number) => currency.format(amount);
const monthId = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const firstDay = (date: Date) => `${monthId(date)}-01`;

function loadEntries(): Entry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Entry =>
      typeof item === 'object' && item !== null &&
      typeof item.id === 'string' &&
      (item.kind === 'income' || item.kind === 'expense') &&
      typeof item.amount === 'number' && Number.isFinite(item.amount) && item.amount > 0 &&
      typeof item.category === 'string' && typeof item.date === 'string',
    );
  } catch {
    return [];
  }
}

function displayDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(year, month - 1, day));
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function EntryForm({ month, initialDate, onAdd }: { month: string; initialDate: string; onAdd: (entry: Entry) => boolean }) {
  const [kind, setKind] = useState<EntryKind>('expense');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [date, setDate] = useState(initialDate);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: FieldErrors = {};
    const number = Number(amount);
    if (!Number.isFinite(number) || number <= 0 || Math.round(number * 100) <= 0) nextErrors.amount = 'Enter an amount greater than zero.';
    if (!category.trim()) nextErrors.category = 'Add a category.';
    if (!date || !date.startsWith(`${month}-`)) nextErrors.date = 'Choose a date in the selected month.';
    setErrors(nextErrors);
    setStatus('');
    if (Object.keys(nextErrors).length) return;

    const saved = onAdd({ id: crypto.randomUUID(), kind, amount: Math.round(number * 100) / 100, category: category.trim(), date });
    if (saved) {
      setAmount('');
      setCategory('');
      setStatus('Entry saved to this browser.');
    } else {
      setStatus('Could not save in this browser. Check storage settings.');
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mt-6 space-y-5">
      <fieldset>
        <legend className="sr-only">Entry type</legend>
        <div className="grid grid-cols-2 gap-2">
          {(['expense', 'income'] as const).map((option) => (
            <label key={option} className="entry-kind flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-field border border-border bg-card px-3 text-small font-semibold transition-[background-color,color,transform] duration-150 hover:-translate-y-px active:scale-[0.97]">
              <input className="sr-only" type="radio" name="kind" value={option} checked={kind === option} onChange={() => setKind(option)} />
              {option === 'expense' ? <ArrowUpRight aria-hidden="true" className="size-4" /> : <ArrowDownLeft aria-hidden="true" className="size-4" />}
              {option === 'expense' ? 'Expense' : 'Income'}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="amount" className="field-label">Amount</label>
        <Input id="amount" type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="0.00" value={amount} aria-invalid={!!errors.amount} aria-describedby={errors.amount ? 'amount-error' : undefined} onChange={(event) => { setAmount(event.target.value); setErrors((current) => ({ ...current, amount: undefined })); }} />
        {errors.amount && <p id="amount-error" className="field-error">{errors.amount}</p>}
      </div>
      <div>
        <label htmlFor="category" className="field-label">Category</label>
        <Input id="category" type="text" maxLength={32} placeholder="e.g. Groceries" value={category} aria-invalid={!!errors.category} aria-describedby={errors.category ? 'category-error' : undefined} onChange={(event) => { setCategory(event.target.value); setErrors((current) => ({ ...current, category: undefined })); }} />
        {errors.category && <p id="category-error" className="field-error">{errors.category}</p>}
      </div>
      <div>
        <label htmlFor="entry-date" className="field-label">Date</label>
        <Input id="entry-date" type="date" value={date} aria-invalid={!!errors.date} aria-describedby={errors.date ? 'date-error' : undefined} onChange={(event) => { setDate(event.target.value); setErrors((current) => ({ ...current, date: undefined })); }} />
        {errors.date && <p id="date-error" className="field-error">{errors.date}</p>}
      </div>
      <Button type="submit" className="w-full"><Plus aria-hidden="true" className="size-4" />Save entry</Button>
      <p role="status" aria-live="polite" className="min-h-5 text-small text-muted-foreground">{status && <><CheckCircle2 aria-hidden="true" className="mr-1 inline size-4" />{status}</>}</p>
    </form>
  );
}

function App() {
  const [today] = useState(() => new Date());
  const [offset, setOffset] = useState(0);
  const [entries, setEntries] = useState<Entry[]>(loadEntries);
  const [exportStatus, setExportStatus] = useState('');
  const [listStatus, setListStatus] = useState('');
  const reducedMotion = useReducedMotion();
  const selectedMonth = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const selectedId = monthId(selectedMonth);
  const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(selectedMonth);
  const entryDate = offset === 0 ? `${selectedId}-${String(today.getDate()).padStart(2, '0')}` : firstDay(selectedMonth);

  const monthEntries = useMemo(() => entries.filter((entry) => entry.date.startsWith(`${selectedId}-`)).sort((a, b) => b.date.localeCompare(a.date)), [entries, selectedId]);
  const income = monthEntries.filter((entry) => entry.kind === 'income').reduce((sum, entry) => sum + entry.amount, 0);
  const expenses = monthEntries.filter((entry) => entry.kind === 'expense').reduce((sum, entry) => sum + entry.amount, 0);
  const categories = useMemo(() => {
    const totals = new Map<string, number>();
    monthEntries.filter((entry) => entry.kind === 'expense').forEach((entry) => totals.set(entry.category, (totals.get(entry.category) || 0) + entry.amount));
    return [...totals].sort((a, b) => b[1] - a[1]);
  }, [monthEntries]);
  const chartColors = ['var(--income)', 'var(--chart-2)', 'var(--expense)', 'var(--chart-4)'];

  function persist(next: Entry[]) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setEntries(next);
      return true;
    } catch {
      return false;
    }
  }

  function changeMonth(direction: number) {
    setOffset((current) => current + direction);
    setExportStatus('');
    setListStatus('');
  }

  function removeEntry(id: string) {
    if (persist(entries.filter((entry) => entry.id !== id))) setListStatus('Entry removed from this browser.');
  }

  function exportCsv() {
    const rows = ['date,type,category,amount', ...monthEntries.map((entry) => [csvCell(entry.date), csvCell(entry.kind), csvCell(entry.category), entry.amount.toFixed(2)].join(','))];
    try {
      const url = URL.createObjectURL(new Blob([rows.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `tally-${selectedId}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportStatus('CSV downloaded.');
    } catch {
      setExportStatus('CSV export failed. Try again.');
    }
  }

  const tileMotion = (index: number) => ({
    initial: { opacity: 0, y: reducedMotion ? 0 : 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.28, delay: index * 0.04, ease: [0.23, 1, 0.32, 1] as const },
    whileHover: { y: reducedMotion ? 0 : -3, transition: { type: 'spring' as const, stiffness: 380, damping: 30 } },
  });

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-background text-foreground">
        <header className="mx-auto flex max-w-[1240px] flex-col gap-4 px-5 pt-7 md:flex-row md:items-center md:justify-between lg:px-10">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-field bg-primary text-primary-foreground"><Wallet aria-hidden="true" className="size-5" /></span>
            <div><div className="font-display text-section font-semibold">tally.</div><p className="text-small text-muted-foreground">Your personal budget, kept here.</p></div>
          </div>
          <div className="flex items-center gap-2 text-small font-medium text-muted-foreground"><LockKeyhole aria-hidden="true" className="size-4" />Saved in this browser only</div>
        </header>

        <main className="mx-auto max-w-[1240px] px-5 pb-12 lg:px-10">
          <section aria-labelledby="page-title" className="mt-12 mb-8 flex flex-col gap-8 md:mt-16 md:flex-row md:items-end md:justify-between">
            <div className="max-w-[640px]">
              <p className="mb-3 text-label font-bold uppercase text-income">monthly overview</p>
              <h1 id="page-title" className="font-display text-heading font-medium text-balance">Make sense of this month.</h1>
              <p className="mt-4 max-w-[500px] text-body text-muted-foreground">Keep income, spending and the little details together in one place.</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center md:shrink-0">
              <div className="flex items-center justify-between gap-1 rounded-field border border-border bg-card p-1 sm:justify-start">
                <Button type="button" size="icon" variant="ghost" aria-label="Previous month" onClick={() => changeMonth(-1)}><ChevronLeft aria-hidden="true" className="size-5" /></Button>
                <span className="min-w-[134px] text-center text-small font-semibold" aria-live="polite">{monthLabel}</span>
                <Button type="button" size="icon" variant="ghost" aria-label="Next month" onClick={() => changeMonth(1)}><ChevronRight aria-hidden="true" className="size-5" /></Button>
              </div>
              <Button type="button" variant="secondary" onClick={exportCsv}><Download aria-hidden="true" className="size-4" />Export CSV</Button>
            </div>
          </section>
          <p role="status" aria-live="polite" className="-mt-5 mb-4 min-h-5 text-right text-small text-muted-foreground">{exportStatus}</p>

          <div className="grid grid-cols-1 gap-gutter md:grid-cols-12">
            <motion.section {...tileMotion(0)} aria-label="Month balance" className="balance-card tile relative flex min-h-[300px] flex-col overflow-hidden rounded-tile p-7 text-primary-foreground md:col-span-7 md:row-span-2 md:min-h-[336px] lg:p-10">
              <div aria-hidden="true" className="balance-orbit" />
              <div className="relative z-10 flex items-center gap-2 text-label font-bold uppercase"><Wallet aria-hidden="true" className="size-4" />month balance</div>
              <div className="relative z-10 my-auto py-8 font-display text-display font-medium [overflow-wrap:anywhere]" aria-label={`Month balance ${formatMoney(income - expenses)}`}>{formatMoney(income - expenses)}</div>
              <div className="relative z-10 flex flex-col gap-2 border-t border-hero-line pt-5 text-small sm:flex-row sm:items-center sm:justify-between">
                <span>Income minus expenses for the selected month.</span><span className="opacity-80">Your numbers stay on this device.</span>
              </div>
            </motion.section>

            <motion.section {...tileMotion(1)} aria-label="Monthly income" className="tile flex min-h-[150px] flex-col justify-between rounded-tile border border-border bg-card p-6 md:col-span-5 lg:p-8">
              <div className="flex items-center justify-between"><span className="text-label font-bold uppercase text-muted-foreground">income</span><span className="flex size-10 items-center justify-center rounded-field bg-secondary text-income"><ArrowDownLeft aria-hidden="true" className="size-5" /></span></div>
              <div><p className="font-display text-stat font-semibold [overflow-wrap:anywhere]">{formatMoney(income)}</p><p className="mt-1 text-small text-muted-foreground">Money in this month</p></div>
            </motion.section>

            <motion.section {...tileMotion(2)} aria-label="Monthly expenses" className="tile flex min-h-[150px] flex-col justify-between rounded-tile border border-border bg-card p-6 md:col-span-5 lg:p-8">
              <div className="flex items-center justify-between"><span className="text-label font-bold uppercase text-muted-foreground">expenses</span><span className="flex size-10 items-center justify-center rounded-field bg-muted text-expense"><ArrowUpRight aria-hidden="true" className="size-5" /></span></div>
              <div><p className="font-display text-stat font-semibold [overflow-wrap:anywhere]">{formatMoney(expenses)}</p><p className="mt-1 text-small text-muted-foreground">Money out this month</p></div>
            </motion.section>

            <motion.section {...tileMotion(3)} aria-labelledby="entry-title" className="tile rounded-tile border border-border bg-card p-6 md:col-span-5 lg:p-8">
              <h2 id="entry-title" className="font-display text-section font-semibold">Add an entry</h2>
              <p className="mt-2 text-body text-muted-foreground">A quick note now makes the month easier to read later.</p>
              <EntryForm key={selectedId} month={selectedId} initialDate={entryDate} onAdd={(entry) => persist([...entries, entry])} />
            </motion.section>

            <motion.section {...tileMotion(4)} aria-labelledby="breakdown-title" className="tile flex min-h-[400px] flex-col rounded-tile border border-border bg-card p-6 md:col-span-7 lg:p-8">
              <h2 id="breakdown-title" className="font-display text-section font-semibold">Spending by category</h2>
              <p className="mt-2 text-body text-muted-foreground">A running view of the categories you enter.</p>
              {categories.length === 0 ? (
                <div className="empty-panel mt-8 flex flex-1 flex-col items-center justify-center rounded-field bg-muted p-6 text-center">
                  <ReceiptText aria-hidden="true" className="mb-4 size-7 text-muted-foreground" />
                  <p className="font-semibold">No expenses recorded yet.</p>
                  <p className="mt-2 max-w-[260px] text-small text-muted-foreground">Add an expense to see where this month's money went.</p>
                </div>
              ) : (
                <div className="mt-9 space-y-7">
                  {categories.map(([category, total], index) => (
                    <div key={category}>
                      <div className="mb-2 flex items-baseline justify-between gap-4 text-small"><span className="min-w-0 truncate font-semibold" title={category}>{category}</span><span className="shrink-0 font-semibold">{formatMoney(total)} <span className="ml-1 font-normal text-muted-foreground">({Math.round(total / expenses * 100)}%)</span></span></div>
                      <div className="h-2.5 overflow-hidden rounded-pill bg-track">
                        <motion.div className="h-full origin-left rounded-pill" style={{ backgroundColor: chartColors[index % chartColors.length] }} initial={{ scaleX: reducedMotion ? total / expenses : 0 }} whileInView={{ scaleX: total / expenses }} viewport={{ once: true, amount: 0.3 }} transition={{ duration: reducedMotion ? 0 : 0.45, ease: [0.23, 1, 0.32, 1] }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.section>

            <motion.section {...tileMotion(5)} aria-labelledby="entries-title" className="tile rounded-tile border border-border bg-card p-6 md:col-span-12 lg:p-8">
              <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end"><div><h2 id="entries-title" className="font-display text-section font-semibold">Entries</h2><p className="mt-2 text-body text-muted-foreground">Every line added for this month.</p></div><p role="status" aria-live="polite" className="text-small text-muted-foreground">{listStatus}</p></div>
              {monthEntries.length === 0 ? (
                <div className="empty-panel mt-6 flex min-h-[160px] flex-col items-center justify-center rounded-field bg-muted p-6 text-center"><ReceiptText aria-hidden="true" className="mb-3 size-6 text-muted-foreground" /><p className="font-semibold">No entries for this month.</p><p className="mt-1 text-small text-muted-foreground">Start with an income or expense above.</p></div>
              ) : (
                <ul className="mt-6" aria-label="Monthly entries">
                  <AnimatePresence initial={false}>
                    {monthEntries.map((entry) => (
                      <motion.li key={entry.id} layout initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reducedMotion ? 0 : 6 }} transition={{ duration: 0.16 }} className="flex min-w-0 items-center gap-3 border-t border-border py-3 first:border-t-0">
                        <span className={`flex size-10 shrink-0 items-center justify-center rounded-field ${entry.kind === 'income' ? 'bg-secondary text-income' : 'bg-muted text-expense'}`}>{entry.kind === 'income' ? <ArrowDownLeft aria-hidden="true" className="size-5" /> : <ArrowUpRight aria-hidden="true" className="size-5" />}</span>
                        <div className="min-w-0 flex-1"><p className="truncate font-semibold" title={entry.category}>{entry.category}</p><p className="text-small text-muted-foreground">{displayDate(entry.date)} · {entry.kind === 'income' ? 'Income' : 'Expense'}</p></div>
                        <span className={`shrink-0 text-small font-bold sm:text-body ${entry.kind === 'income' ? 'text-income' : 'text-expense'}`}>{entry.kind === 'income' ? '+' : '-'}{formatMoney(entry.amount)}</span>
                        <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${entry.category} entry`} title="Remove entry" onClick={() => removeEntry(entry.id)}><Trash2 aria-hidden="true" className="size-4" /></Button>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </motion.section>
          </div>
        </main>
        <footer className="mx-auto max-w-[1240px] px-5 py-8 text-small text-muted-foreground lg:px-10">No account. No sync. Clearing site data removes your entries.</footer>
      </div>
    </MotionConfig>
  );
}

export default App;
