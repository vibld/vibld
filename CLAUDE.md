# Conventions for this repository

House rules that apply to code, comments, documentation, commit messages,
pull request text and the copy this product generates.

## Do the work rather than describing it

Do not answer a request with a command for somebody else to run. Run it. If a
step genuinely cannot be run from the working environment, because it needs a
credential or a value that is not there, say so in one line and put
everything around it into something that does run: a workflow step, a script,
a committed config change.

A command handed back in a reply is an admission that the task was not
finished.

## Instructions that a person has to follow: concise, exact, with URLs

When a step really is somebody else's to take, give the shortest exact path:

- a real URL, not "go to Settings -> ..."
- the literal field names and values
- no explanation of why, unless it was asked for

If a deep link cannot be constructed, say so in one line and give the nearest
URL that can be.

## No em-dashes

Not a stylistic preference to weigh against others: do not use the character,
anywhere. Use a comma, a colon, parentheses, or two sentences.

`scripts/no-em-dash.mjs` enforces this across every tracked file, and
`pnpm check:style` runs it.

The double hyphen this repository uses in prose is a different character and
is fine. Do not read it as evidence that em-dashes are wanted.

## Counts in copy are rounded down: "200+ templates", not "207 templates"

Chris's rule (docs/decisions.md, D105). Wherever vibld.com or the builder
tells a reader how many of something the product has, the number is rounded
down to a friendly "N+":

- under 10: exact ("4 moving backgrounds");
- 10 to 99: down to the ten ("24 style presets" is "20+ style presets");
- 100 and over: down to the hundred ("207" is "200+", "1,656" is "1,600+").

Prices, measured costs, durations and plan limits are facts, not counts, and
stay exact. On vibld.com the rule is `approxCount` in
`apps/marketing/app/counts.ts`; `apps/marketing/test/counts.test.ts` fails on
an exact count in a built page.

## Licensing is the maintainer's decision

Never decide on the maintainer's behalf whether something can be used,
adopted, copied or shipped. State the facts -- what licence file exists or
does not, what it grants, what it does not cover -- and then stop. Do not
exclude something from consideration because of its licence, and do not
present a licensing conclusion as if the analysis were finished.

## Everything else

Ask rather than infer.
