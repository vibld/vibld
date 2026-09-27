---
{
  "intent": "A landing page for Tripline, an external attack surface monitoring service for companies of 5 to 200 people without a full-time security team, whose single job is to get a visitor to start the 14-day trial.",
  "tokens": {
    "colors": [
      {
        "name": "primary",
        "value": "#E8FF52",
        "use": "Fill of the two trial buttons (hero and Team plan), the focus ring and the brief success pulse; nowhere else"
      },
      {
        "name": "primary-foreground",
        "value": "#0A0A0A",
        "use": "Label text on primary fills (about 17:1 against #E8FF52)"
      },
      {
        "name": "secondary",
        "value": "#1A1A1A",
        "use": "Fill of the Starter and Business plan buttons and the reset button"
      },
      {
        "name": "secondary-foreground",
        "value": "#FFFFFF",
        "use": "Text on secondary buttons"
      },
      {
        "name": "accent",
        "value": "#B9CC3F",
        "use": "Hover fill of primary buttons only"
      },
      {
        "name": "accent-foreground",
        "value": "#0A0A0A",
        "use": "Text on the accent hover fill"
      },
      {
        "name": "background",
        "value": "#0A0A0A",
        "use": "Page ground, input fill, text on white fills"
      },
      {
        "name": "foreground",
        "value": "#FFFFFF",
        "use": "Primary text, the recommended card border, white badges, billing pill and contact submit button"
      },
      {
        "name": "card",
        "value": "#121212",
        "use": "Console, pricing cards, form panel, Setup and FAQ bands"
      },
      {
        "name": "card-foreground",
        "value": "#FFFFFF",
        "use": "Text on cards"
      },
      {
        "name": "muted",
        "value": "#1F1F1F",
        "use": "Hover fill of ghost links and secondary buttons"
      },
      {
        "name": "muted-foreground",
        "value": "#9A9A9A",
        "use": "Supporting text, labels, placeholders (6.6:1 on #121212)"
      },
      {
        "name": "border",
        "value": "#2A2A2A",
        "use": "Hairlines, card borders, bento gutters, input borders"
      },
      {
        "name": "ring",
        "value": "#E8FF52",
        "use": "Keyboard focus ring"
      },
      {
        "name": "destructive",
        "value": "#FF5C5C",
        "use": "Form validation text and invalid input border, always with a CircleAlert icon"
      },
      {
        "name": "destructive-foreground",
        "value": "#0A0A0A",
        "use": "Text on a destructive fill (defined for completeness, no destructive fill on this page)"
      },
      {
        "name": "scrim",
        "value": "rgba(10, 10, 10, 0.82)",
        "use": "Sticky header fill behind the backdrop blur"
      },
      {
        "name": "grid-line",
        "value": "rgba(255, 255, 255, 0.05)",
        "use": "Hairline grid pattern behind the hero"
      }
    ],
    "fonts": [
      {
        "role": "display",
        "family": "Space Grotesk",
        "fallback": "ui-sans-serif, system-ui, sans-serif",
        "weights": [
          500,
          600,
          700
        ]
      },
      {
        "role": "body",
        "family": "IBM Plex Sans",
        "fallback": "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif",
        "weights": [
          400,
          500,
          600
        ]
      }
    ],
    "type": [
      {
        "name": "display",
        "size": "clamp(2.75rem, 1.5rem + 5.2vw, 5.25rem)",
        "lineHeight": "0.95",
        "letterSpacing": "-0.035em"
      },
      {
        "name": "numeral",
        "size": "clamp(7rem, 3rem + 14vw, 13rem)",
        "lineHeight": "0.8",
        "letterSpacing": "-0.06em"
      },
      {
        "name": "title",
        "size": "clamp(2rem, 1.3rem + 2.8vw, 3.5rem)",
        "lineHeight": "1.02",
        "letterSpacing": "-0.03em"
      },
      {
        "name": "price",
        "size": "3rem",
        "lineHeight": "1",
        "letterSpacing": "-0.03em"
      },
      {
        "name": "heading",
        "size": "1.375rem",
        "lineHeight": "1.25",
        "letterSpacing": "-0.015em"
      },
      {
        "name": "lead",
        "size": "1.1875rem",
        "lineHeight": "1.55",
        "letterSpacing": "-0.005em"
      },
      {
        "name": "body",
        "size": "1rem",
        "lineHeight": "1.6",
        "letterSpacing": "0em"
      },
      {
        "name": "small",
        "size": "0.875rem",
        "lineHeight": "1.5",
        "letterSpacing": "0em"
      },
      {
        "name": "label",
        "size": "0.75rem",
        "lineHeight": "1.4",
        "letterSpacing": "0.08em"
      }
    ],
    "space": [
      {
        "name": "gutter",
        "value": "24px"
      },
      {
        "name": "content",
        "value": "1152px (max-w-6xl)"
      },
      {
        "name": "section-y",
        "value": "96px, 128px from 1024px"
      },
      {
        "name": "header",
        "value": "64px"
      },
      {
        "name": "card-pad",
        "value": "24px, 32px from 640px"
      },
      {
        "name": "hit-target",
        "value": "44px minimum"
      }
    ],
    "radii": [
      {
        "name": "sm",
        "value": "4px"
      },
      {
        "name": "md",
        "value": "6px"
      },
      {
        "name": "lg",
        "value": "8px"
      },
      {
        "name": "pill",
        "value": "999px"
      }
    ],
    "effects": [
      {
        "name": "header-glass",
        "value": "background: rgba(10, 10, 10, 0.82); backdrop-filter: blur(12px); border-bottom: 1px solid #2A2A2A"
      },
      {
        "name": "hero-grid",
        "value": "background-image: linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px); background-size: 48px 48px; mask-image: radial-gradient(ellipse 70% 60% at 30% 35%, black 30%, transparent 75%)"
      },
      {
        "name": "shadow-panel",
        "value": "0 24px 48px -24px rgba(0, 0, 0, 0.8)"
      },
      {
        "name": "focus-ring",
        "value": "0 0 0 2px #E8FF52 with a 2px #0A0A0A offset"
      },
      {
        "name": "success-pulse",
        "value": "2px solid #E8FF52 inset border fading opacity 1 to 0 over 500ms, cubic-bezier(0.23, 1, 0.32, 1)"
      },
      {
        "name": "entrance",
        "value": "opacity 0 and translateY(8-16px) to rest over 150-180ms, cubic-bezier(0.23, 1, 0.32, 1), hero staggered 60ms"
      },
      {
        "name": "billing-pill",
        "value": "white pill moved with layoutId on a spring, stiffness 500, damping 35"
      }
    ]
  },
  "sections": [
    {
      "id": "header",
      "purpose": "Sticky brand and section navigation",
      "layout": "Sticky, 64px tall, full width glass bar; inner row max 1152px, 24px gutters, logo left, links right; each link 44px tall. Coverage and FAQ links hidden below 768px.",
      "copy": [
        {
          "role": "link",
          "text": "Skip to content"
        },
        {
          "role": "link",
          "text": "Tripline"
        },
        {
          "role": "link",
          "text": "Coverage"
        },
        {
          "role": "link",
          "text": "Pricing"
        },
        {
          "role": "link",
          "text": "FAQ"
        },
        {
          "role": "link",
          "text": "Contact"
        }
      ]
    },
    {
      "id": "hero",
      "purpose": "State the offer and ask for the trial",
      "layout": "Max 1152px; single column on mobile with 64px top padding; from 1024px a 12-column split, copy in 7 columns left, sample findings console in 5 columns right, 112px top and bottom padding. Hairline grid masked behind. Copy staggers in 60ms apart within 180ms each.",
      "copy": [
        {
          "role": "label",
          "text": "External attack surface monitoring"
        },
        {
          "role": "heading",
          "text": "Find the exposed server before someone else does."
        },
        {
          "role": "body",
          "text": "Tripline maps what your company has on the public internet, rechecks it on a schedule, and tells you in plain words what changed and how to close it."
        },
        {
          "role": "button",
          "text": "Start a 14-day trial"
        },
        {
          "role": "link",
          "text": "See what it checks"
        },
        {
          "role": "body",
          "text": "The trial needs no card, and nothing gets installed on your servers."
        },
        {
          "role": "label",
          "text": "acme-corp.example"
        },
        {
          "role": "label",
          "text": "Sample data"
        },
        {
          "role": "status",
          "text": "Last scan 14 min ago. 212 hosts watched, 5 open findings."
        },
        {
          "role": "label",
          "text": "High"
        },
        {
          "role": "label",
          "text": "Medium"
        },
        {
          "role": "label",
          "text": "Low"
        },
        {
          "role": "body",
          "text": "Admin login page is public"
        },
        {
          "role": "body",
          "text": "staging.acme-corp.example/wp-admin"
        },
        {
          "role": "body",
          "text": "PostgreSQL port 5432 open"
        },
        {
          "role": "body",
          "text": "db-02.acme-corp.example"
        },
        {
          "role": "body",
          "text": "Certificate expires in 9 days"
        },
        {
          "role": "body",
          "text": "mail.acme-corp.example"
        },
        {
          "role": "body",
          "text": "SPF record allows any sender"
        },
        {
          "role": "body",
          "text": "acme-corp.example"
        },
        {
          "role": "body",
          "text": "New subdomain discovered"
        },
        {
          "role": "body",
          "text": "dev-billing.acme-corp.example"
        },
        {
          "role": "status",
          "text": "New"
        },
        {
          "role": "status",
          "text": "2 d"
        },
        {
          "role": "status",
          "text": "5 d"
        },
        {
          "role": "status",
          "text": "12 d"
        },
        {
          "role": "status",
          "text": "Next scan in 5 h 46 min"
        }
      ]
    },
    {
      "id": "coverage",
      "purpose": "Answer what it checks and whether it is noisy or invasive",
      "layout": "Max 1152px, left-aligned intro max 768px, then a bento with 1px #2A2A2A gutters inside an 8px-radius frame: 1 column mobile, 2 at 768px, 3 at 1024px where the domain cell spans 2 columns and 2 rows and an oversized 6h numeral bleeds off its cell's right edge.",
      "copy": [
        {
          "role": "label",
          "text": "Coverage"
        },
        {
          "role": "heading",
          "text": "Everything an attacker can see from outside, checked on a schedule."
        },
        {
          "role": "body",
          "text": "Tripline looks at your company the way a stranger with a port scanner would, then files what it finds as work your team can close."
        },
        {
          "role": "heading",
          "text": "It starts from one domain"
        },
        {
          "role": "body",
          "text": "Give Tripline your root domain. It follows public records outward to find hosts your team forgot about, then asks you to confirm which ones are yours before it scans them."
        },
        {
          "role": "label",
          "text": "Where it looks"
        },
        {
          "role": "body",
          "text": "Certificate transparency logs"
        },
        {
          "role": "body",
          "text": "Passive and active DNS"
        },
        {
          "role": "body",
          "text": "Registered IP ranges"
        },
        {
          "role": "body",
          "text": "Cloud provider hostnames"
        },
        {
          "role": "label",
          "text": "Asset map (sample)"
        },
        {
          "role": "body",
          "text": "api.acme-corp.example"
        },
        {
          "role": "body",
          "text": "staging.acme-corp.example"
        },
        {
          "role": "body",
          "text": "dev-billing.acme-corp.example"
        },
        {
          "role": "body",
          "text": "status.acme-corp.example"
        },
        {
          "role": "status",
          "text": "Confirmed"
        },
        {
          "role": "status",
          "text": "Needs review"
        },
        {
          "role": "status",
          "text": "Vendor, out of scope"
        },
        {
          "role": "label",
          "text": "6h"
        },
        {
          "role": "heading",
          "text": "Rescan interval"
        },
        {
          "role": "body",
          "text": "Every confirmed host is rescanned every six hours on Team, and every hour on Business."
        },
        {
          "role": "heading",
          "text": "Findings read like tickets"
        },
        {
          "role": "body",
          "text": "Each one names the host, what is exposed, why it matters and the change that closes it, with the raw evidence attached: the HTTP response, the certificate or the DNS record."
        },
        {
          "role": "heading",
          "text": "Quiet until something changes"
        },
        {
          "role": "body",
          "text": "You hear about new findings and ones that got worse. An issue you have accepted as a known risk stays silent unless its severity rises."
        },
        {
          "role": "heading",
          "text": "Nothing to install"
        },
        {
          "role": "body",
          "text": "Scans run from outside your network. There are no agents to deploy, no firewall rules to open and no credentials to hand over."
        },
        {
          "role": "heading",
          "text": "Alerts where you already work"
        },
        {
          "role": "body",
          "text": "Send findings to Slack, Microsoft Teams, email or any webhook, routed by severity and by domain. PagerDuty comes with Business."
        }
      ]
    },
    {
      "id": "setup",
      "purpose": "Show how fast the first result arrives",
      "layout": "Full-width #121212 band with 1px borders top and bottom; max 1152px; intro left max 672px; ordered list of 4 steps, 1 column mobile, 2 at 768px, 4 at 1024px, 40px gap, each topped by a 1px rgba white 20% rule.",
      "copy": [
        {
          "role": "label",
          "text": "Setup"
        },
        {
          "role": "heading",
          "text": "From domain to first findings in about an hour."
        },
        {
          "role": "label",
          "text": "Minute 0"
        },
        {
          "role": "heading",
          "text": "Add your root domain"
        },
        {
          "role": "body",
          "text": "Type it in, prove you control it with a DNS TXT record, and choose where alerts go."
        },
        {
          "role": "label",
          "text": "Minute 20"
        },
        {
          "role": "heading",
          "text": "Review the asset map"
        },
        {
          "role": "body",
          "text": "Tripline lists every host it attributes to you. Mark anything that belongs to a vendor or a retired project, and it drops out of scope."
        },
        {
          "role": "label",
          "text": "Hour 1"
        },
        {
          "role": "heading",
          "text": "Read ranked findings"
        },
        {
          "role": "body",
          "text": "The first full scan finishes and findings arrive ranked by how reachable each one is and how much damage it could do."
        },
        {
          "role": "label",
          "text": "Every 6 hours"
        },
        {
          "role": "heading",
          "text": "Get the diff"
        },
        {
          "role": "body",
          "text": "Each rescan compares against the last. You hear about what is new, what got worse and what you fixed."
        }
      ]
    },
    {
      "id": "proof",
      "purpose": "Trust before the ask, honestly marked as placeholder",
      "layout": "Max 1152px, editorial column spanning columns 3 to 10 of 12 from 1024px; dashed label pill, Quote icon, pull quote in the title step, caption, then a closing paragraph max 640px.",
      "copy": [
        {
          "role": "label",
          "text": "Placeholder testimonial"
        },
        {
          "role": "body",
          "text": "Replace this with a customer's own words about a finding Tripline caught."
        },
        {
          "role": "label",
          "text": "Name, role, company (placeholder)"
        },
        {
          "role": "body",
          "text": "Until that quote exists, the trial is the proof: point it at your own domain and judge the first findings, which arrive within the hour."
        }
      ]
    },
    {
      "id": "pricing",
      "purpose": "Three parallel tiers with billing toggle and the limit and cancellation answers",
      "layout": "Max 1152px; header row with intro left and billing tabs right from 1024px; tiers 1 column then 3 at 1024px, 16px gap, Team card with a white border and white Recommended badge; below, a 1px rule and a 2-column answer grid from 768px.",
      "copy": [
        {
          "role": "label",
          "text": "Pricing"
        },
        {
          "role": "heading",
          "text": "Priced by the number of hosts we watch."
        },
        {
          "role": "body",
          "text": "Every plan runs every check. Plans differ in how many hosts we watch, how often we rescan them and where alerts can go."
        },
        {
          "role": "button",
          "text": "Monthly"
        },
        {
          "role": "button",
          "text": "Annual"
        },
        {
          "role": "body",
          "text": "Annual billing: pay for 10 months, get 12."
        },
        {
          "role": "heading",
          "text": "Starter"
        },
        {
          "role": "body",
          "text": "For one product with a small public footprint."
        },
        {
          "role": "heading",
          "text": "Team"
        },
        {
          "role": "label",
          "text": "Recommended"
        },
        {
          "role": "body",
          "text": "For companies running several products without a full-time security hire."
        },
        {
          "role": "heading",
          "text": "Business"
        },
        {
          "role": "body",
          "text": "For security teams that need scale, SSO and an API."
        },
        {
          "role": "body",
          "text": "$49"
        },
        {
          "role": "body",
          "text": "$41"
        },
        {
          "role": "body",
          "text": "$149"
        },
        {
          "role": "body",
          "text": "$124"
        },
        {
          "role": "body",
          "text": "$399"
        },
        {
          "role": "body",
          "text": "$333"
        },
        {
          "role": "label",
          "text": "/month"
        },
        {
          "role": "body",
          "text": "Billed monthly"
        },
        {
          "role": "body",
          "text": "$490 billed yearly"
        },
        {
          "role": "body",
          "text": "$1,490 billed yearly"
        },
        {
          "role": "body",
          "text": "$3,990 billed yearly"
        },
        {
          "role": "body",
          "text": "Up to 25 hosts"
        },
        {
          "role": "body",
          "text": "1 root domain"
        },
        {
          "role": "body",
          "text": "Daily rescans"
        },
        {
          "role": "body",
          "text": "Email alerts"
        },
        {
          "role": "body",
          "text": "30 days of finding history"
        },
        {
          "role": "body",
          "text": "2 seats"
        },
        {
          "role": "body",
          "text": "Up to 250 hosts"
        },
        {
          "role": "body",
          "text": "5 root domains"
        },
        {
          "role": "body",
          "text": "Rescans every 6 hours"
        },
        {
          "role": "body",
          "text": "Slack, Teams, email and webhook alerts"
        },
        {
          "role": "body",
          "text": "90 days of finding history"
        },
        {
          "role": "body",
          "text": "10 seats"
        },
        {
          "role": "body",
          "text": "Up to 2,000 hosts"
        },
        {
          "role": "body",
          "text": "Unlimited root domains"
        },
        {
          "role": "body",
          "text": "Hourly rescans"
        },
        {
          "role": "body",
          "text": "Every alert channel, plus PagerDuty"
        },
        {
          "role": "body",
          "text": "1 year of finding history"
        },
        {
          "role": "body",
          "text": "SAML SSO and REST API"
        },
        {
          "role": "body",
          "text": "Unlimited seats"
        },
        {
          "role": "button",
          "text": "Choose Starter"
        },
        {
          "role": "button",
          "text": "Start a 14-day trial"
        },
        {
          "role": "button",
          "text": "Choose Business"
        },
        {
          "role": "heading",
          "text": "What happens at the host limit"
        },
        {
          "role": "body",
          "text": "Scanning keeps running for 14 days after you pass it. We email the account owner on day 1 and day 10, so there is time to upgrade or take hosts out of scope."
        },
        {
          "role": "heading",
          "text": "Cancelling"
        },
        {
          "role": "body",
          "text": "Cancel from Settings at any time. Monthly plans end with the current month, and annual plans are refunded for each unused full month."
        },
        {
          "role": "body",
          "text": "Prices in USD, excluding sales tax and VAT."
        }
      ]
    },
    {
      "id": "faq",
      "purpose": "Remaining doubts about legality, safety, access, limits, cancelling, trial end and data residency",
      "layout": "Full-width #121212 band; max 1152px; from 1024px heading in 4 columns, sticky at 96px, accordion in 7 columns starting at column 6; single-open accordion with 44px+ triggers.",
      "copy": [
        {
          "role": "label",
          "text": "FAQ"
        },
        {
          "role": "heading",
          "text": "Questions people ask before the trial"
        },
        {
          "role": "body",
          "text": "Something missing?"
        },
        {
          "role": "link",
          "text": "Ask us directly"
        },
        {
          "role": "heading",
          "text": "Is it legal for you to scan our systems?"
        },
        {
          "role": "body",
          "text": "Before any scan, you prove you control each root domain with a DNS TXT record. Tripline only scans hosts you have confirmed as yours, and the confirmation log can be exported for your auditors."
        },
        {
          "role": "heading",
          "text": "Can the scans break anything?"
        },
        {
          "role": "body",
          "text": "The checks are read-only. Tripline reads banners, headers, certificates and DNS records, and never attempts logins, exploits or load tests. Scan traffic comes from a fixed set of IP addresses listed in your dashboard, so your team can recognise it."
        },
        {
          "role": "heading",
          "text": "Do you need access to our network or cloud accounts?"
        },
        {
          "role": "body",
          "text": "No. Everything Tripline checks is visible from the public internet. On Business you can add read-only AWS, Azure or Google Cloud connectors to match hosts to the teams that own them, but scanning works without them."
        },
        {
          "role": "heading",
          "text": "What happens if we go over our host limit?"
        },
        {
          "role": "body",
          "text": "Scanning continues for 14 days. We email the account owner on day 1 and day 10, and you can upgrade or mark hosts out of scope. After 14 days, the most recently discovered hosts pause until you are back under the limit."
        },
        {
          "role": "heading",
          "text": "Can we cancel at any time?"
        },
        {
          "role": "body",
          "text": "Yes, from Settings, without talking to anyone. Monthly plans end with the current billing month. Annual plans are refunded for every unused full month."
        },
        {
          "role": "heading",
          "text": "What happens when the trial ends?"
        },
        {
          "role": "body",
          "text": "The trial runs the full Team plan for 14 days without a card. When it ends, scanning pauses until you choose a plan. Your asset map and findings are kept for 30 days, then deleted."
        },
        {
          "role": "heading",
          "text": "Where is our data stored?"
        },
        {
          "role": "body",
          "text": "In the EU (Frankfurt) or the US (Virginia). You pick the region at signup, and findings, evidence and backups stay in it."
        }
      ]
    },
    {
      "id": "contact",
      "purpose": "Questions and sales contact, demonstration only",
      "layout": "Max 1152px; from 1024px intro in 5 columns, form panel in 7; panel #121212 with 1px border, 32px padding; name and email side by side from 640px; white submit button; success panel replaces the form.",
      "copy": [
        {
          "role": "label",
          "text": "Contact"
        },
        {
          "role": "heading",
          "text": "Tell us what you need to protect."
        },
        {
          "role": "body",
          "text": "Scope questions, a vendor security review, or a plan that does not fit: the engineers who build the scanner read these messages and reply within one working day."
        },
        {
          "role": "label",
          "text": "Email"
        },
        {
          "role": "body",
          "text": "hello@tripline.example"
        },
        {
          "role": "label",
          "text": "Vulnerability reports"
        },
        {
          "role": "body",
          "text": "security@tripline.example"
        },
        {
          "role": "status",
          "text": "About: Team plan, billed annually"
        },
        {
          "role": "label",
          "text": "Name"
        },
        {
          "role": "placeholder",
          "text": "Jordan Lee"
        },
        {
          "role": "label",
          "text": "Work email"
        },
        {
          "role": "placeholder",
          "text": "jordan@company.com"
        },
        {
          "role": "label",
          "text": "Company"
        },
        {
          "role": "label",
          "text": "(optional)"
        },
        {
          "role": "placeholder",
          "text": "Company name"
        },
        {
          "role": "label",
          "text": "Message"
        },
        {
          "role": "placeholder",
          "text": "We have about 80 public hosts across AWS and an older data centre, and want to know what is exposed."
        },
        {
          "role": "status",
          "text": "This form is a demonstration. Nothing is sent, and nothing you type leaves your browser."
        },
        {
          "role": "button",
          "text": "Send message"
        },
        {
          "role": "status",
          "text": "Sending"
        },
        {
          "role": "status",
          "text": "Enter your name."
        },
        {
          "role": "status",
          "text": "Enter your work email."
        },
        {
          "role": "status",
          "text": "That email looks incomplete. Use the form name@company.com."
        },
        {
          "role": "status",
          "text": "Add a little more detail, at least 20 characters."
        },
        {
          "role": "heading",
          "text": "Message checked and ready"
        },
        {
          "role": "status",
          "text": "This demo stops here and sends nothing. On the live site, a reply would go to the address you entered within one working day."
        },
        {
          "role": "button",
          "text": "Write another message"
        }
      ]
    },
    {
      "id": "footer",
      "purpose": "Close with honest provenance",
      "layout": "Max 1152px, 40px vertical padding, stacked on mobile, one row from 768px.",
      "copy": [
        {
          "role": "link",
          "text": "Tripline"
        },
        {
          "role": "body",
          "text": "Tripline is a sample product made for this page. Its names, prices and data are illustrative."
        },
        {
          "role": "link",
          "text": "Coverage"
        },
        {
          "role": "link",
          "text": "Pricing"
        },
        {
          "role": "link",
          "text": "FAQ"
        },
        {
          "role": "link",
          "text": "Contact"
        },
        {
          "role": "body",
          "text": "© 2025 Tripline"
        }
      ]
    }
  ],
  "breakpoints": [
    {
      "maxWidth": 640,
      "changes": [
        "From 640px (sm) the hero actions sit in one row instead of stacking",
        "From 640px the contact name and work email fields sit side by side",
        "From 640px card and panel padding grows from 24px to 32px"
      ]
    },
    {
      "maxWidth": 768,
      "changes": [
        "From 768px (md) the header shows the Coverage and FAQ links",
        "From 768px hero top padding grows from 64px to 96px",
        "From 768px the coverage bento has 2 columns and the asset map sits beside the source list",
        "From 768px setup steps sit in 2 columns and the pricing answers in 2 columns",
        "From 768px the footer becomes one row"
      ]
    },
    {
      "maxWidth": 1024,
      "changes": [
        "From 1024px (lg) the hero splits 7/5 with the console on the right and 112px vertical padding",
        "From 1024px the bento has 3 columns with the domain cell spanning 2 columns and 2 rows",
        "From 1024px setup steps sit in 4 columns and sections use 128px vertical padding",
        "From 1024px the pricing header puts the billing tabs on the right and the tiers sit in 3 columns",
        "From 1024px FAQ splits 4/7 with a sticky heading and contact splits 5/7"
      ]
    }
  ],
  "do": [
    "Use #E8FF52 (--primary) only on the two Start a 14-day trial buttons, the focus ring and the success pulse; every other surface is greyscale from #0A0A0A to #FFFFFF.",
    "Set headings in Space Grotesk on text-display clamp(2.75rem, 1.5rem + 5.2vw, 5.25rem) at -0.035em and body in IBM Plex Sans at 16px/1.6.",
    "Keep motion between 150ms and 180ms on cubic-bezier(0.23, 1, 0.32, 1); the billing pill is the only spring (stiffness 500, damping 35).",
    "Separate surfaces with 1px #2A2A2A borders and #121212 cards; only the hero console carries shadow-panel.",
    "Pair every severity and status with a text label (High, Medium, Low, Confirmed, Needs review) beside its greyscale treatment."
  ],
  "avoid": [
    "A second saturated colour such as a blue link or green success state: the acid yellow would stop reading as the one signal (#FF5C5C appears only for form errors, beside an icon).",
    "A third yellow button in the header or on the contact form: the trial stops being the page's single ask.",
    "Invented customer logos, quotes, breach numbers or certifications: there is nothing real to cite, so the testimonial stays marked as a placeholder.",
    "Ambient loops, parallax or cursor-follow effects: this direction keeps the page still apart from entrances and state changes.",
    "Posting the contact form anywhere: there is no backend, and the page says so."
  ],
  "checks": [
    "At 1440px the hero headline sits left and the findings console right, labelled Sample data.",
    "The only yellow fills on the page are the hero Start a 14-day trial button and the Team card button.",
    "Clicking Monthly moves the white pill and Team shows $149 /month with Billed monthly; Annual shows $124 /month with $1,490 billed yearly.",
    "Clicking Choose Business scrolls to the contact form, shows About: Business plan, billed annually, and puts focus in Name.",
    "Submitting the empty form shows Enter your name. under Name with an alert icon, and focus moves to Name.",
    "A valid submit disables the button with a spinner and Sending, then shows Message checked and ready with a brief yellow outline pulse.",
    "The form states This form is a demonstration. Nothing is sent, and nothing you type leaves your browser.",
    "At 375px nothing scrolls horizontally and the 6h numeral is clipped inside its cell.",
    "The FAQ answers what happens over the host limit and how to cancel, and arrow keys move between its questions."
  ]
}
---

# Design

A landing page for Tripline, an external attack surface monitoring service for companies of 5 to 200 people without a full-time security team, whose single job is to get a visitor to start the 14-day trial.

The frontmatter above is this project's design spec: every colour, font, type step, space, radius and effect it uses, each section's copy verbatim, and what changes at each breakpoint. Change the spec and the code together.

## Do

- Use #E8FF52 (--primary) only on the two Start a 14-day trial buttons, the focus ring and the success pulse; every other surface is greyscale from #0A0A0A to #FFFFFF.
- Set headings in Space Grotesk on text-display clamp(2.75rem, 1.5rem + 5.2vw, 5.25rem) at -0.035em and body in IBM Plex Sans at 16px/1.6.
- Keep motion between 150ms and 180ms on cubic-bezier(0.23, 1, 0.32, 1); the billing pill is the only spring (stiffness 500, damping 35).
- Separate surfaces with 1px #2A2A2A borders and #121212 cards; only the hero console carries shadow-panel.
- Pair every severity and status with a text label (High, Medium, Low, Confirmed, Needs review) beside its greyscale treatment.

## Don't

- A second saturated colour such as a blue link or green success state: the acid yellow would stop reading as the one signal (#FF5C5C appears only for form errors, beside an icon).
- A third yellow button in the header or on the contact form: the trial stops being the page's single ask.
- Invented customer logos, quotes, breach numbers or certifications: there is nothing real to cite, so the testimonial stays marked as a placeholder.
- Ambient loops, parallax or cursor-follow effects: this direction keeps the page still apart from entrances and state changes.
- Posting the contact form anywhere: there is no backend, and the page says so.

## Checks

- At 1440px the hero headline sits left and the findings console right, labelled Sample data.
- The only yellow fills on the page are the hero Start a 14-day trial button and the Team card button.
- Clicking Monthly moves the white pill and Team shows $149 /month with Billed monthly; Annual shows $124 /month with $1,490 billed yearly.
- Clicking Choose Business scrolls to the contact form, shows About: Business plan, billed annually, and puts focus in Name.
- Submitting the empty form shows Enter your name. under Name with an alert icon, and focus moves to Name.
- A valid submit disables the button with a spinner and Sending, then shows Message checked and ready with a brief yellow outline pulse.
- The form states This form is a demonstration. Nothing is sent, and nothing you type leaves your browser.
- At 375px nothing scrolls horizontally and the 6h numeral is clipped inside its cell.
- The FAQ answers what happens over the host limit and how to cancel, and arrow keys move between its questions.
