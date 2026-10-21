import type { FieldSpec } from "@/components/proposal-settings/fields";
import type { SectionKey } from "@/lib/proposal-template/schema";

const APPLIES = [
  { value: "all", label: "All jobs" },
  { value: "interior", label: "Interior jobs" },
  { value: "exterior", label: "Exterior jobs" },
];
const clauseList = (path: string, label: string, extra: FieldSpec[] = []): FieldSpec => ({
  kind: "list",
  path,
  label,
  itemLabel: "Item",
  titlePath: "text",
  newItem: { id: "", text: "", appliesTo: "all" },
  fields: [
    { kind: "prose", path: "text", label: "Wording", rows: 3, hint: "Plain text" },
    { kind: "select", path: "appliesTo", label: "Show on", options: APPLIES },
    ...extra,
  ],
});

export interface PageDef {
  key: string;
  label: string;
  /** Shared settings for this page. */
  section?: { key: SectionKey; title: string; description?: string; fields: FieldSpec[] };
  /** Settings that can differ per job type. */
  jobTypes?: { title: string; description?: string; fields: FieldSpec[] };
}

export const PAGES: PageDef[] = [
  { key: "overview", label: "Overview" },
  { key: "documents", label: "Insurance documents" },
  {
    key: "cover",
    label: "Cover",
    jobTypes: {
      title: "Cover per job type",
      description: "The first thing customers see. Interior and exterior jobs can have their own headline and photo.",
      fields: [
        { kind: "text", path: "cover.headline", label: "Headline" },
        { kind: "prose", path: "cover.intro", label: "Introduction" },
        { kind: "image", path: "cover.heroImage", label: "Cover photo", aspect: "3/2" },
        { kind: "text", path: "cover.statement", label: "Big statement (optional)", hint: "Wrap words in *asterisks* to make them teal" },
      ],
    },
    section: {
      key: "cover",
      title: "Shared cover wording",
      fields: [
        { kind: "text", path: "ctaLabel", label: "Button text" },
        { kind: "prose", path: "introClosing", label: "Closing line under the introduction" },
        { kind: "text", path: "statement", label: "Big statement", hint: "Wrap words in *asterisks* to make them teal" },
        { kind: "prose", path: "statementBody", label: "Text under the statement" },
      ],
    },
  },
  {
    key: "about",
    label: "About us",
    section: {
      key: "about",
      title: "About us",
      fields: [
        { kind: "banner", path: "banner", label: "Section banner" },
        { kind: "heading", label: "“You're in good hands”" },
        { kind: "text", path: "goodHands.title", label: "Heading" },
        { kind: "prose", path: "goodHands.body", label: "Text", rows: 5 },
        { kind: "image", path: "goodHands.image", label: "Photo", aspect: "3/2" },
        { kind: "heading", label: "History and mission" },
        { kind: "text", path: "history.title", label: "Heading" },
        { kind: "prose", path: "history.body", label: "Text", rows: 8 },
        { kind: "image", path: "history.image", label: "Photo", aspect: "4/5" },
        { kind: "text", path: "connectLabel", label: "Label before the social buttons" },
      ],
    },
  },
  {
    key: "whyUs",
    label: "Why us",
    section: {
      key: "whyUs",
      title: "Why work with us",
      fields: [
        { kind: "banner", path: "banner", label: "Section banner" },
        {
          kind: "list",
          path: "tiles",
          label: "Reasons",
          itemLabel: "Reason",
          titlePath: "title",
          min: 1,
          max: 9,
          newItem: { id: "", title: "", text: "", icon: { src: "/proposal/why-quality-workmanship.png", alt: "", focalX: 50, focalY: 50 } },
          fields: [
            { kind: "text", path: "title", label: "Title" },
            { kind: "prose", path: "text", label: "Text", rows: 2 },
            { kind: "image", path: "icon", label: "Icon", decorative: true },
          ],
        },
      ],
    },
  },
  {
    key: "reviews",
    label: "Reviews",
    section: {
      key: "reviews",
      title: "Reviews",
      description: "Only one review can be featured. It's shown large above the others.",
      fields: [
        { kind: "banner", path: "banner", label: "Section banner" },
        {
          kind: "list",
          path: "items",
          label: "Reviews",
          itemLabel: "Review",
          titlePath: "author",
          max: 12,
          newItem: { id: "", quote: "", author: "", rating: 5, featured: false, jobType: "all" },
          fields: [
            { kind: "prose", path: "quote", label: "Review", rows: 4, hint: "Paste the review as written" },
            { kind: "text", path: "author", label: "Name" },
            { kind: "select", path: "rating", label: "Stars", numeric: true, options: [5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${n} stars` })) },
            { kind: "select", path: "jobType", label: "Show on", options: APPLIES },
            { kind: "bool", path: "featured", label: "Featured review" },
          ],
        },
      ],
    },
  },
  {
    key: "portfolio",
    label: "Portfolio",
    jobTypes: {
      title: "Photos per job type",
      description: "Up to 12 photos each. Photos are cropped to 3:2 in the grid; customers can tap one to see it whole.",
      fields: [{ kind: "images", path: "portfolio", label: "Photos", max: 12 }],
    },
    section: { key: "portfolio", title: "Portfolio banner", fields: [{ kind: "banner", path: "banner", label: "Section banner" }] },
  },
  {
    key: "resources",
    label: "Insurance & FAQ text",
    section: {
      key: "resources",
      title: "Insurance & FAQ wording",
      description: "The documents themselves are under Insurance documents.",
      fields: [
        { kind: "banner", path: "banner", label: "Section banner" },
        { kind: "prose", path: "intro", label: "Blue band text" },
        { kind: "text", path: "insurance.title", label: "Insurance heading" },
        { kind: "prose", path: "insurance.body", label: "Insurance text" },
        { kind: "text", path: "faq.title", label: "FAQ heading" },
        { kind: "prose", path: "faq.body", label: "FAQ text" },
      ],
    },
    jobTypes: {
      title: "Photos per job type",
      fields: [
        { kind: "image", path: "insuranceImage", label: "Insurance photo", aspect: "3/2" },
        { kind: "image", path: "faqImage", label: "FAQ photo", aspect: "3/2" },
      ],
    },
  },
  {
    key: "estimate",
    label: "Estimate document",
    section: {
      key: "estimateDocument",
      title: "Estimate document",
      fields: [
        { kind: "banner", path: "banner", label: "Section banner" },
        { kind: "text", path: "documentTitle", label: "Document title" },
        { kind: "text", path: "numberPrefix", label: "Number prefix", hint: "EST- gives EST-5012" },
        { kind: "bool", path: "showTaxLine", label: "Show the GST line in the totals" },
        { kind: "bool", path: "showAreaPrices", label: "Show a price beside each area" },
        { kind: "strings", path: "paymentMethods", label: "Accepted payment methods" },
        { kind: "prose", path: "defaultMessage", label: "Default message", hint: "Used when you don't type a message while sending" },
        { kind: "strings", path: "footerNotes", label: "Notes under “Terms”" },
        { kind: "heading", label: "Service lines" },
        { kind: "block", path: "preparationByScope.interior", label: "Interior preparation" },
        { kind: "block", path: "preparationByScope.exterior", label: "Exterior preparation" },
        { kind: "text", path: "areasToBePainted.title", label: "“Areas to be painted” title" },
        { kind: "text", path: "areasToBePainted.leadIn", label: "“Areas to be painted” lead-in" },
        { kind: "text", path: "areasToBeExcluded.title", label: "“Excluded” title" },
        { kind: "text", path: "areasToBeExcluded.leadIn", label: "“Excluded” lead-in" },
        { kind: "text", path: "areasToBeExcluded.closing", label: "“Excluded” closing line" },
        { kind: "text", path: "optionTitle", label: "Upgrade title", hint: "{title} is the upgrade's name" },
        { kind: "text", path: "paintLineTitle", label: "Paint line title", hint: "{surface} is Walls, Trim, Siding…" },
        { kind: "heading", label: "Labels" },
        ...(
          [
            ["estimateDate", "Estimate date"],
            ["expiryDate", "Expiry date"],
            ["poNumber", "PO number"],
            ["from", "From"],
            ["licence", "Licence"],
            ["gst", "GST"],
            ["email", "Email"],
            ["phone", "Phone"],
            ["to", "To"],
            ["jobLocation", "Job location"],
            ["job", "Job"],
            ["services", "Services"],
            ["subtotal", "Subtotal"],
            ["taxes", "Taxes"],
            ["grandTotal", "Grand total"],
            ["deposit", "Deposit"],
            ["paymentMethods", "Payment methods"],
            ["message", "Message"],
            ["terms", "Terms"],
          ] as const
        ).map(([k, label]): FieldSpec => ({ kind: "text", path: `labels.${k}`, label })),
      ],
    },
    jobTypes: {
      title: "Per job type",
      fields: [
        { kind: "select", path: "areasListMode", label: "List areas as", options: [{ value: "areas", label: "Rooms / areas" }, { value: "surfaces", label: "Surfaces (siding, trim…)" }] },
        { kind: "prose", path: "areasExcludedDefault", label: "Areas excluded (one per line)", hint: "Used when the estimate doesn't list its own exclusions" },
        { kind: "block", path: "servicesInclude", label: "Services include" },
      ],
    },
  },
  {
    key: "contract",
    label: "Contract & warranty",
    section: {
      key: "contract",
      title: "Terms & conditions",
      description: "Changes apply to proposals you send from now on. Proposals already sent keep the terms the customer saw.",
      fields: [
        { kind: "banner", path: "banner", label: "Section banner" },
        { kind: "prose", path: "intro", label: "Opening paragraph" },
        { kind: "block", path: "scopeOfWork", label: "Scope of work" },
        { kind: "text", path: "termsTitle", label: "Terms heading" },
        clauseList("clauses", "Terms", [{ kind: "prose", path: "textExterior", label: "Different wording for exterior jobs (optional)", rows: 2 }]),
        { kind: "text", path: "values.colourConsultFee", label: "Colour consultation fee", hint: "Fills {colourConsultFee}, e.g. $250" },
        { kind: "heading", label: "Warranty" },
        { kind: "text", path: "warranty.title", label: "Heading" },
        { kind: "prose", path: "warranty.intro", label: "Introduction", hint: "{warrantyMonths} comes from Warranty length per job type below" },
        { kind: "strings", path: "warranty.conditions", label: "Conditions" },
        { kind: "text", path: "warranty.exclusionsLeadIn", label: "Exclusions lead-in" },
        {
          kind: "list",
          path: "warranty.exclusions",
          label: "Exclusions",
          itemLabel: "Exclusion",
          titlePath: "text",
          newItem: { id: "", text: "", children: [], appliesTo: "all" },
          fields: [
            { kind: "prose", path: "text", label: "Wording", rows: 2 },
            { kind: "text", path: "note", label: "Note (optional, shown in italics)" },
            { kind: "strings", path: "children", label: "Sub-points (optional)" },
            { kind: "select", path: "appliesTo", label: "Show on", options: APPLIES },
          ],
        },
        { kind: "prose", path: "warranty.closing", label: "Closing paragraphs", rows: 6 },
        { kind: "heading", label: "Other parts" },
        { kind: "text", path: "qualityStandards.title", label: "Quality standards heading" },
        clauseList("qualityStandards.items", "Quality standards"),
        { kind: "text", path: "paintsMaterials.title", label: "Paints/materials heading" },
        clauseList("paintsMaterials.items", "Paints/materials", [{ kind: "bool", path: "emphasis", label: "Highlight as important" }]),
        { kind: "block", path: "unforeseen", label: "Unforeseen conditions" },
        { kind: "text", path: "customerResponsibility.title", label: "Customer responsibility heading" },
        clauseList("customerResponsibility.items", "Customer responsibility"),
        { kind: "block", path: "insurance", label: "Insurance" },
        { kind: "text", path: "acceptance.title", label: "Acceptance heading" },
        { kind: "strings", path: "acceptance.items", label: "Acceptance points" },
        { kind: "text", path: "payment.title", label: "Payment heading" },
        { kind: "strings", path: "payment.items", label: "Payment points", hint: "One per line. {depositPct} is the deposit, e.g. 20%" },
      ],
    },
    jobTypes: { title: "Warranty length per job type", fields: [{ kind: "number", path: "warrantyMonths", label: "Warranty (months)" }] },
  },
  {
    key: "nextStep",
    label: "Next step & signing",
    section: {
      key: "nextStep",
      title: "Next step",
      fields: [
        { kind: "banner", path: "banner", label: "Section banner" },
        { kind: "image", path: "image", label: "Photo (optional)", aspect: "21/9", nullable: true },
        { kind: "text", path: "heading", label: "Heading" },
        { kind: "strings", path: "steps", label: "Steps (1 to 5)" },
        { kind: "text", path: "totalLabel", label: "Label above the total" },
        { kind: "text", path: "acceptLabel", label: "Accept button" },
        { kind: "text", path: "declineLabel", label: "Decline button" },
        { kind: "text", path: "agreeLabel", label: "Agreement checkbox", hint: "“…and that my electronic signature is legally binding” is added automatically" },
      ],
    },
  },
  {
    key: "links",
    label: "Buttons & menu",
    section: {
      key: "links",
      title: "Buttons and links",
      fields: [
        { kind: "link", path: "learnMore", label: "Why us button" },
        { kind: "link", path: "reviews", label: "Reviews button" },
        { kind: "link", path: "portfolio", label: "Portfolio button" },
        { kind: "link", path: "faq", label: "FAQ button" },
        { kind: "href", path: "pcaStandards", label: "PCA standards link", hint: "Fills {pcaStandardsUrl} in the quality standards" },
        { kind: "href", path: "facebook", label: "Facebook page" },
        { kind: "href", path: "instagram", label: "Instagram" },
        { kind: "href", path: "website", label: "Website" },
      ],
    },
  },
];

export const MENU_SECTION: PageDef["section"] = {
  key: "nav",
  title: "Menu labels",
  description: "The section names in the bar at the top of the proposal.",
  fields: (
    [
      ["about", "About"],
      ["whyUs", "Why us"],
      ["reviews", "Reviews"],
      ["portfolio", "Portfolio"],
      ["insurance", "Insurance"],
      ["yourProject", "Your project"],
      ["terms", "Terms"],
      ["nextStep", "Next step"],
    ] as const
  ).map(([k, label]): FieldSpec => ({ kind: "text", path: k, label })),
};
