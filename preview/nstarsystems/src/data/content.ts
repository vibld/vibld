export type Accent = 'amber' | 'teal' | 'steel'

export interface NavLink {
  href: string
  label: string
}

export interface Solution {
  id: string
  title: string
  summary: string
  points: string[]
  accent: Accent
}

export interface Stat {
  value: number
  decimals: number
  suffix: string
  label: string
}

export interface Industry {
  name: string
  description: string
}

export interface Step {
  number: string
  title: string
  body: string
}

export interface Quote {
  text: string
  name: string
  role: string
  organization: string
}

export interface ContactDetail {
  label: string
  value: string
  href?: string
}

export interface FooterColumn {
  title: string
  links: NavLink[]
}

export const navLinks: NavLink[] = [
  { href: '#solutions', label: 'Solutions' },
  { href: '#industries', label: 'Industries' },
  { href: '#process', label: 'Our Process' },
  { href: '#about', label: 'About' },
  { href: '#contact', label: 'Contact' },
]

export const solutions: Solution[] = [
  {
    id: 'managed-it',
    title: 'Managed IT Services',
    summary:
      'A dedicated service desk, proactive monitoring and lifecycle management for every server, workstation and endpoint you run. Our engineers resolve issues before your team notices them.',
    points: [
      '24/7 help desk with 15-minute response targets',
      'Patch management and asset lifecycle planning',
      'Quarterly technology road-mapping reviews',
    ],
    accent: 'amber',
  },
  {
    id: 'security',
    title: 'Cybersecurity & Compliance',
    summary:
      'Layered defense built around your risk profile: identity, endpoint, network and email protection backed by continuous threat hunting. We map every control to the frameworks your auditors ask about.',
    points: [
      'Managed detection and response',
      'HIPAA, PCI DSS and SOC 2 readiness',
      'Phishing simulation and staff training',
    ],
    accent: 'teal',
  },
  {
    id: 'cloud',
    title: 'Cloud & Infrastructure',
    summary:
      'Design, migration and optimization across private, public and hybrid cloud, with cost governance baked in from day one. We right-size workloads and keep your spend visible.',
    points: [
      'Microsoft 365, Azure and AWS migrations',
      'Hybrid virtualization and storage design',
      'Continuous cost and capacity optimization',
    ],
    accent: 'steel',
  },
  {
    id: 'network',
    title: 'Network Design & Deployment',
    summary:
      'Structured cabling, switching, wireless and SD-WAN engineered for the buildings and campuses you actually occupy. Every design ships with documentation your team can use.',
    points: [
      'Wireless site surveys and heat mapping',
      'SD-WAN and multi-site connectivity',
      'As-built documentation and labeling',
    ],
    accent: 'amber',
  },
  {
    id: 'backup',
    title: 'Data Backup & Recovery',
    summary:
      'Immutable, air-gapped backups with tested recovery runbooks, so a bad day never becomes a lost business. Recovery objectives are agreed, measured and reported.',
    points: [
      'Hourly incremental and daily full backups',
      'Documented recovery time objectives',
      'Semi-annual restore testing',
    ],
    accent: 'teal',
  },
  {
    id: 'communications',
    title: 'Unified Communications',
    summary:
      'Voice, video, contact center and collaboration platforms delivered as a managed service across every location and every device your staff uses.',
    points: [
      'Cloud PBX and Microsoft Teams voice',
      'Contact center and call flow design',
      'Carrier selection and number porting',
    ],
    accent: 'steel',
  },
]

export const stats: Stat[] = [
  {
    value: 99.98,
    decimals: 2,
    suffix: '%',
    label: 'Measured network uptime across managed client environments',
  },
  {
    value: 500,
    decimals: 0,
    suffix: '+',
    label: 'Organizations supported across New England and beyond',
  },
  {
    value: 24,
    decimals: 0,
    suffix: '/7',
    label: 'Live monitoring and service desk coverage, every day of the year',
  },
  {
    value: 15,
    decimals: 0,
    suffix: ' min',
    label: 'Average first response time during business hours',
  },
]

export const industries: Industry[] = [
  {
    name: 'Healthcare',
    description:
      'Clinical networks, medical device segmentation and HIPAA safeguards for clinics, imaging centers and specialty practices.',
  },
  {
    name: 'Financial Services',
    description:
      'Segmented networks, audit-ready evidence and continuous monitoring for banks, credit unions and advisory firms.',
  },
  {
    name: 'Manufacturing & Logistics',
    description:
      'Plant-floor networking, barcode and inventory system support, and connectivity that survives a warehouse environment.',
  },
  {
    name: 'Professional Services',
    description:
      'Email security, document management and collaboration that keep legal, accounting and consulting teams productive.',
  },
  {
    name: 'Education',
    description:
      'Campus wireless, E-Rate friendly procurement and student data protections for districts and independent schools.',
  },
  {
    name: 'Government & Public Sector',
    description:
      'Secure infrastructure, CJIS-aligned controls and dependable support for municipal and county agencies.',
  },
]

export const steps: Step[] = [
  {
    number: '01',
    title: 'Assess',
    body: 'We inventory every device, application and connection, then interview your team to understand where technology helps and where it gets in the way. You receive a written assessment with findings ranked by business risk.',
  },
  {
    number: '02',
    title: 'Design',
    body: 'Our architects translate the assessment into a phased roadmap with budgets, timelines and clear ownership. Nothing is proposed that we cannot support after it goes live.',
  },
  {
    number: '03',
    title: 'Deploy',
    body: 'Engineers perform the work after hours when needed, with rollback plans for every change. You get as-built documentation, staff training and a go-live report.',
  },
  {
    number: '04',
    title: 'Manage',
    body: 'Ongoing monitoring, patching, backup verification and quarterly reviews keep the environment stable. Your account team stays the same people you met on day one.',
  },
]

export const quotes: Quote[] = [
  {
    text: 'NStar Systems inherited a network that three vendors had left half-finished. Within a quarter, outages stopped being a weekly topic at our leadership meetings.',
    name: 'Dana Whitfield',
    role: 'Chief Operating Officer',
    organization: 'Merrimack Valley Health Partners',
  },
  {
    text: 'Their team documented our environment better than we ever had internally. When our auditor asked for evidence, we produced it in an afternoon.',
    name: 'Marcus Ellery',
    role: 'VP of Information Technology',
    organization: 'Harborline Credit Union',
  },
  {
    text: 'We run three shifts across two plants. NStar designed the wireless so handheld scanners actually work on the floor, and they have answered every call since.',
    name: 'Priya Raman',
    role: 'Director of Operations',
    organization: 'Corbin Industrial Supply',
  },
]

export const aboutPoints: string[] = [
  'Vendor-neutral recommendations — we are not paid to prefer one platform over another.',
  'Fixed-fee managed service agreements with no surprise line items.',
  'A named account team, not a rotating queue of anonymous technicians.',
  'Documentation you own outright and can hand to any future provider.',
]

export const contactDetails: ContactDetail[] = [
  { label: 'Email', value: 'hello@nstarsystems.com', href: 'mailto:hello@nstarsystems.com' },
  { label: 'Phone', value: '(508) 555-0142', href: 'tel:+15085550142' },
  { label: 'Support desk', value: '(508) 555-0188', href: 'tel:+15085550188' },
  { label: 'Office', value: '118 Turnpike Road, Suite 210, Westborough, MA 01581' },
  { label: 'Hours', value: 'Monday to Friday, 8:00am – 6:00pm ET. Emergencies answered 24/7.' },
]

export const footerColumns: FooterColumn[] = [
  {
    title: 'Solutions',
    links: [
      { href: '#solutions', label: 'Managed IT Services' },
      { href: '#solutions', label: 'Cybersecurity & Compliance' },
      { href: '#solutions', label: 'Cloud & Infrastructure' },
      { href: '#solutions', label: 'Network Design & Deployment' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '#about', label: 'About NStar Systems' },
      { href: '#process', label: 'Our Process' },
      { href: '#industries', label: 'Industries' },
      { href: '#contact', label: 'Contact' },
    ],
  },
]
