export type Service = {
  title: string;
  description: string;
};

export type CaseStudy = {
  title: string;
  client: string;
  problem: string;
  approach: string;
  result: string;
};

export const services: Service[] = [
  {
    title: "Operating model design",
    description: "We map how decisions move through your company and rebuild the handoffs so work flows from a request to a finished output without waiting on a manager.",
  },
  {
    title: "Cost reduction that holds",
    description: "Cutting spend usually returns in two quarters. We chase the drivers: duplicate approvals, unused software seats, and freight lanes that ship air.",
  },
  {
    title: "Pricing and margin work",
    description: "We rebuild price lists and discount rules so every order covers its own cost before the sales team applies a concession.",
  },
  {
    title: "First-line manager training",
    description: "Your supervisors hold more leverage over output than any executive. We build a weekly planning routine they can run without us after three months.",
  },
];

export const caseStudies: CaseStudy[] = [
  {
    title: "Rebuilding a stalled fulfillment process",
    client: "A regional wholesale distributor",
    problem: "Orders entered the warehouse on paper, were picked by memory, and left on a truck whenever the dock crew had time. Large accounts waited four days while small accounts got same-day treatment.",
    approach: "We pulled a week of dispatch records, separated the real demand pattern from the dock crew's habit, and set a two-slot daily schedule. The supervisor learned to adjust the slots in fifteen minutes each morning.",
    result: "The warehouse now clears orders on the day they arrive, and the manager runs the schedule without help. The client cancelled plans to add a third shift.",
  },
  {
    title: "Cutting quote turnaround without adding staff",
    client: "A mid-sized contract manufacturer",
    problem: "Every quote needed three signatures, each person changed the margin, and the final price often arrived after the prospect had signed elsewhere.",
    approach: "We replaced the approval chain with a pricing table that the estimator could use directly, with a weekly review of exceptions instead of a per-quote sign-off.",
    result: "Quotes go out in under two hours, and the sales team closes on price instead of apologizing for it. The head of sales stopped carrying a folder of approval prints.",
  },
];
