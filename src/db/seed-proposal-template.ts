/**
 * Starter proposal template: Grandview's own wording and pictures from their
 * Markate proposal, kept verbatim (typos included) for the owner to review in
 * Settings → Proposals. Changed or suggested text is listed in SUGGESTED_NOTES.
 */
import type { ImageRef, ProposalTemplate } from "@/lib/proposal-template/schema";

const img = (src: string, alt: string, focalX = 50, focalY = 50): ImageRef => ({ src, alt, focalX, focalY });
const icon = (name: string): ImageRef => img(`/proposal/why-${name}.png`, "");

const HERO_INTERIOR = img("/proposal/hero-interior.jpg", "Bright entrance hall with white panelled walls, wood floors and a curved wood staircase");
const HERO_EXTERIOR = img(
  "/proposal/hero-exterior.jpg",
  "Two-storey home with stone accents, grey siding and a double garage, with a Grandview Painting sign on the front lawn",
);
const CREW_INTERIOR = img("/proposal/insurance-crew-interior.jpg", "Two Grandview Painting painters in white uniforms in a bright entry with a staircase");
const CREW_EXTERIOR = img("/proposal/insurance-crew-exterior.jpg", "Two Grandview Painting painters with arms crossed in front of a white-sided house");
const FAQ_CREW = img("/proposal/faq-crew.jpg", "Two Grandview Painting painters holding a paint can in front of a home's front door");

const PORTFOLIO_INTERIOR: ImageRef[] = [
  img("/proposal/portfolio-interior-01.jpg", "Family room with coffered ceiling, built-in wood entertainment unit and fireplace"),
  img("/proposal/portfolio-interior-02.jpg", "Dining room with white wainscoting, coffered ceiling and an arched doorway"),
  img("/proposal/portfolio-interior-03.jpg", "White ensuite bathroom with freestanding tub and glass shower"),
  img("/proposal/portfolio-interior-04.jpg", "Open-plan main floor with white kitchen, staircase and fireplace after painting"),
  img("/proposal/portfolio-interior-05.jpg", "Open living and dining area with light grey walls, white trim and a stone fireplace column"),
  img("/proposal/portfolio-interior-06.jpg", "Vaulted living room with light grey walls, white stone fireplace and tall windows"),
  img("/proposal/portfolio-interior-07.jpg", "Grandview Painting painter in a branded shirt rolling paint beside a white panelled door"),
  img("/proposal/portfolio-interior-08.jpg", "Grandview Painting painter sanding a wall with a dust-extraction sander over protected floors"),
  img("/proposal/portfolio-interior-09.jpg", "Grandview Painting painter cutting in paint along the ceiling line next to a white door"),
];
const PORTFOLIO_EXTERIOR: ImageRef[] = [
  img("/proposal/portfolio-exterior-01.jpg", "Two-storey home with beige siding and a brick-trimmed double garage, Grandview Painting sign on the lawn"),
  img("/proposal/portfolio-exterior-02.jpg", "Light grey character home with white trim and black railings, Grandview Painting sign on the lawn"),
  img("/proposal/portfolio-exterior-03.jpg", "Pale yellow heritage-style house with a white porch and stairs, Grandview Painting sign on the walkway"),
  img("/proposal/portfolio-exterior-04.jpg", "Grey-sided home with a dark pergola and stone-clad deck, Grandview Painting sign on the lawn"),
  img("/proposal/portfolio-exterior-05.jpg", "Two-storey home with stone accents, grey siding and a double garage, Grandview Painting sign on the lawn"),
  img("/proposal/portfolio-exterior-06.jpg", "Blue-grey rancher with white trim and a large picture window, Grandview Painting sign on the lawn"),
  img("/proposal/portfolio-exterior-07.jpg", "Large white colonial-style home with dark shutters on a wide lot"),
  img("/proposal/portfolio-exterior-08.jpg", "Red Craftsman house with cream trim and blue-grey porch stairs"),
];
const PORTFOLIO_MIXED = [...PORTFOLIO_EXTERIOR.slice(0, 4), ...PORTFOLIO_INTERIOR.slice(0, 4)];

const EXTERIOR_COVER = {
  headline: "BRING BACK YOUR HOME'S CURB APPEAL",
  intro:
    "The exterior of your home is people’s first impression. Take pride in your home by keeping it looking cared-for and current! Our experienced painters can make any exterior finishes look like new, and understand what paints are best for the lower mainland’s unique climate.",
  heroImage: HERO_EXTERIOR,
};

export const DEFAULT_PROPOSAL_TEMPLATE: ProposalTemplate = {
  version: 1,
  nav: {
    about: "About Us",
    whyUs: "Why us",
    reviews: "Reviews",
    portfolio: "Portfolio",
    insurance: "Insurance",
    yourProject: "Your Project",
    terms: "Terms & Conditions",
    nextStep: "Next step",
  },
  links: {
    learnMore: { label: "+ LEARN MORE ABOUT US", href: "https://www.grandviewpainting.ca/" },
    reviews: {
      label: "+ CHECK OUT MORE OF OUR 5 STAR REVIEWS",
      href: "https://www.google.com/search?q=grandview+painting#lrd=0x5485dded6facfb8b:0x767c2b569f997188,1,,,",
    },
    portfolio: { label: "+ VIEW MORE OF OUR WORK", href: "https://www.grandviewpainting.ca/our-portfolio/" },
    faq: { label: "+ LEARN MORE", href: "https://www.grandviewpainting.ca/house-painting-resources/faq/" },
    pcaStandards: "https://pcapainted.org/wp-content/uploads/2019/05/PDCA-Standards-May28-2019.pdf",
    facebook: "https://www.facebook.com/grandviewpainters/",
    instagram: "https://www.instagram.com/grandview.painting/",
    website: "https://www.grandviewpainting.ca/",
  },
  cover: {
    ctaLabel: "View Proposal",
    introClosing:
      "Thank you for the opportunity to quote your {jobTypeLabel} painting project.  Attached you will find a customized proposal for you to review, outlining all aspects of your project!",
    statement: "RESIDENTIAL PAINTING SERVICES WITH *BEAUTIFUL WORKMANSHIP* THAT WILL GIVE YOUR HOME *A FRESH START*.",
    statementBody: [
      "When someone arrives at your home, something as simple as the colour and quality of the paint can make an incredible impact on their first impression. This is why painting is one of the most popular home improvement projects around – it gives homeowners the chance to make their homes shine like new, inside and out.",
      "With help from our team here at Grandview Painting, you can come home to a property that feels fresh, new, and reflects your personal style.",
    ].join("\n\n"),
  },
  about: {
    banner: { title: "About Us", subtitle: "GET TO KNOW YOUR PAINTING CONTRACTORS" },
    goodHands: {
      title: "You're in good hands",
      body: "Here at Grandview Painting, we are proud to offer the best professional painting service in the lower mainland. Our mission is to give our customers a full-service experience of the highest quality, and care for their every need as we work to beautify their homes.",
      image: img("/proposal/about-good-hands.jpg", "Grandview Painting painter crouching on a lawn beside a paint sprayer and a white dog"),
    },
    history: {
      title: "Our History. Our Mission.",
      body: [
        "Grandview Painting was created with one thing in mind: to give great painting services that meet the highest standards of quality.",
        "The painting industry is full of contractors ranging from small, independent contractors to large-scale companies, and we fall right in the middle. Having noticed a lack of professionalism, and service in the metro Vancouver residential painting market, Grandview Painting was born. A primary focus of ours is treating our customers with respect, integrity, and clear communication.",
        "It’s all about service, and about making sure that you feel confident with your choice, knowing you are getting the safest solution in the field. We take pride in our work, and treat every home as if it were our own. We care, and it shows. We never take final payment until a customer is completely satisfied. This means our customers never have to worry about quality – they know it’s our top priority.",
      ].join("\n\n"),
      image: img("/proposal/about-history-chamber.jpg", "Grandview Painting representative at a South Surrey & White Rock Chamber of Commerce event"),
    },
    connectLabel: "LET'S CONNECT:",
  },
  whyUs: {
    banner: { title: "Why Work With Us?", subtitle: "BEAUTIFUL WORKMANSHIP - LISTENING TO YOUR NEEDS" },
    tiles: [
      { id: "excellent-communication", title: "Excellent Communication", text: "Always know what's happening with your painting project", icon: icon("excellent-communication") },
      { id: "detailed-proposals", title: "Detailed Proposals", text: "We provide very detailed proposals so you know exactly what you're getting", icon: icon("detailed-proposals") },
      {
        id: "3-year-warranty",
        title: "3 Year Warranty",
        text: "We back our work with a full 3 year warranty. Some additional products include a lifetime warranty",
        icon: icon("3-year-warranty"),
      },
      { id: "colour-consultations", title: "Colour Consultations", text: "We offer in-house consultations with professional designers", icon: icon("colour-consultations") },
      { id: "fully-insured", title: "Fully Insured", text: "We carry general liability and WCB so you don't have to worry", icon: icon("fully-insured") },
      { id: "quality-workmanship", title: "Quality Workmanship", text: "Thorough prep and quality painting, always!", icon: icon("quality-workmanship") },
    ],
  },
  reviews: {
    banner: { title: "Reviews", subtitle: "WHAT OUR CLIENTS HAVE TO SAY" },
    // Markate shows all four on every proposal, so they start as "all"; the owner can tag them per job type.
    items: [
      {
        id: "steve-b",
        author: "Steve B.",
        rating: 5,
        featured: true,
        jobType: "all",
        quote:
          "We worked with Grandview Painting for the complete exterior painting of our 120-year-old home in East Vancouver. What an incredible transformation. We interviewed 8 different painting companies before selecting Grandview. I was very impressed with the owner Johnny's professionalism, communication, expertise, and fantastic value. It was also important to us to support a local business and not a large chain. Johnny and his team were fantastic to work with, and the house transformation was incredible. A couple of neighbours asked for his info after we finished for their own homes. His team worked through an intense heatwave of 40+ degrees in Vancouver without any complaint or work stoppage. Absolutely incredible. The team is super friendly, knowledgeable and skilled, and a great presence to have around the house. I would highly recommend Grandview to any family or friend, you will be glad you went with them.",
      },
      {
        id: "m-greymac",
        author: "M Greymac",
        rating: 5,
        featured: false,
        jobType: "all",
        quote:
          "My experience with Grandview Painting was very positive. Johnny's professional integrity and business etiquettes are exemplary. I felt informed throughout the whole process with a detailed quote, knowledgeable suggestions, and updated communication. Not to mention, the exterior painting of the house looks great! Why did I choose Grandview Painting? The reason is the clarity of the communication gave me the confidence of a trustworthy and competent business. Thanks, Johnny great job!",
      },
      {
        id: "leslie-b",
        author: "Leslie B.",
        rating: 5,
        featured: false,
        jobType: "all",
        quote:
          "Absolutely our highest recommendation for outstanding service in every area! From the moment I reached out to Johnny he was very quick to respond, extremely organized and transparent. We knew exactly what was happening and was very knowledgeable about his products. The paint work of his team was perfect and everything was completed as discussed and even earlier than promised! If I could give more stars, I would!",
      },
      {
        id: "david-a",
        author: "David A.",
        rating: 5,
        featured: false,
        jobType: "all",
        quote:
          "Johnny came highly recommended to us, and went over each step of repainting our old house. He communicated everything very well and left nothing out. His quote was prepared to list all services and then we received a welcome email with a detailed schedule. We agreed on a start date and he arrived with a helper to power wash. The weather cooperated and he and his crew started on time every day. Sanding, scraping, and filling with the best couple of guys that had no problem going the extra mile with our 110-year-old house. Christine and I would highly recommend Grandview Painting.",
      },
    ],
  },
  portfolio: { banner: { title: "Portfolio", subtitle: "OUR HARD WORK ON DISPLAY" } },
  resources: {
    banner: { title: "Resources", subtitle: "WHAT YOU NEED TO KNOW" },
    intro:
      "Your home is a safe space, and we are committed to making sure you have all the information you need to make the right decision when it comes to who will be working in it. If you have any questions about the way we work, don’t hesitate to reach out to us.",
    insurance: {
      title: "Insurance",
      body: "We are dedicated to making sure you, your family and our painters remain safe during your painting project. We follow the regulations and protocols set by WorkSafe BC to ensure the safety of everyone involved.",
    },
    faq: {
      title: "Frequently Asked Questions",
      body: "Have questions about our process, or home painting in general? We’ve got the answers for you. Or give us a call anytime for more information.",
    },
  },
  estimateDocument: {
    banner: { title: "Your Project", subtitle: "YOUR CUSTOMIZED ESTIMATE" },
    documentTitle: "Estimate",
    numberPrefix: "EST-",
    labels: {
      estimateDate: "Estimate Date",
      expiryDate: "Expiry Date",
      poNumber: "Purchase Order#",
      from: "FROM",
      licence: "License",
      gst: "GST/HST #",
      email: "Email",
      phone: "Phone",
      to: "TO",
      jobLocation: "JOB LOCATION",
      job: "JOB",
      services: "Services",
      subtotal: "Subtotal (without tax)",
      taxes: "Taxes",
      grandTotal: "Grand Total ($)",
      deposit: "Deposit due on acceptance",
      paymentMethods: "Accepted payment methods",
      message: "Message",
      terms: "Terms",
    },
    showTaxLine: true,
    showAreaPrices: false,
    preparationByScope: {
      interior: {
        title: "Interior Preparation",
        body: "All floors, and areas being painted will thoroughly be covered and protected for the duration of the work. Any wall damage/holes will be filled with a drywall spackle or filling compound, sanded and spot primed. Any trim will be filled if necessary and caulked at butt joints, corners and baseboard/crown edges where trim meets wall. Switch plate covers will be removed and reinstalled when finished. Walls and other surfaces being painted will be scuff sanded prior to painting",
      },
      exterior: {
        title: "Exterior Preparation",
        body: "Gently pressurewash any area's being painted to remove loose flaking paint, dust, cobwebs, algae and any other dirt. Mask areas not being painted. Scrape & sand remaining loose and flaking paint where needed. Prime those bare areas, and any other bare wood with an alkyd based primer. Caulk all butt joints, corner boards, window trim, and any other areas where needed. If applicable, remove downspouts and reinstall once completed.",
      },
    },
    areasToBePainted: { title: "Areas To Be Painted", leadIn: "Areas to be painted include :" },
    areasToBeExcluded: { title: "Areas To Be Excluded", leadIn: "Areas to be excluded:", closing: "Any other area not listed in line # {areasLineNo}" },
    optionTitle: "Optional {title}",
    paintLineTitle: "Paint {surface}",
    paymentMethods: ["Credit Card", "Check", "Cash", "Direct Deposit"],
    defaultMessage:
      "Thank you for the opportunity to quote this project! We hope this detailed contract will fulfill what you are looking for when hiring a contractor. We would be pleased to work with you!\n\nA {depositPct}% booking deposit is required upon accepting. Terms and Conditions are included below.",
    footerNotes: ["Deposits can be e-transferred to info@grandviewpainting.ca", "All credit card payments are subject to a 2.4% processing fee"],
  },
  contract: {
    banner: { title: "Terms & Conditions", subtitle: "THE DETAILS OF OUR AGREEMENT" },
    values: { colourConsultFee: "$250" },
    intro:
      "Grandview Painting agrees to furnish the labor, materials, and supplies necessary to perform the services per the terms and conditions in this Contract. Upon completion of the services, Grandview Painting will remove all materials, supplies, and other debris.",
    scopeOfWork: {
      title: "Project Description/Scope of Work",
      body: "Please take special note of the job description. Grandview Painting is not required to perform any tasks not specified in the estimate.\n\nWhen the project is complete, all job sites will be cleaned prior to leaving.",
    },
    termsTitle: "Terms & Conditions",
    clauses: [
      {
        id: "colour-consultation",
        appliesTo: "all",
        text: "Unless otherwise stated, a colour consultation with a professional designer can be arranged for an additional {colourConsultFee}",
      },
      {
        id: "neighbour-access",
        appliesTo: "exterior",
        text: "For exterior projects - For safety purposes, access to neighbouring properties may be required to achieve safe ladder positioning. Grandview painting requests all neighbours be notified of work commencing prior to the pressure washing phase.",
      },
      {
        id: "masking-tape",
        appliesTo: "all",
        text: "As part of the preparation process, Grandview Painting commonly masks areas not being painted with a low-tack painter’s grade tape. Client agrees that if the tape removes the finish of any surface, it is not the responsibility of Grandview Painting.",
      },
      {
        id: "photography",
        appliesTo: "all",
        text: "Before and after photography of your project may be used for marketing purposes. Grandview Painting respects your privacy, and all personal information is kept strictly confidential.",
      },
      {
        id: "paint-ready",
        appliesTo: "all",
        text: "Client and Grandview painting agree work will only commence once the project is considered to be “paint ready” For renovations this means trades are clear of areas and the site is dust and debris free.",
      },
      {
        id: "clear-contents",
        appliesTo: "all",
        text: "Client agrees to clear areas being painted of all contents prior to work beginning.  Any large items can be coordinated with Grandview Painting staff.",
        textExterior:
          "Client agrees to clear areas being painted of all contents prior to work beginning (exterior work means prior to pressure washing) Any large items can be coordinated with Grandview Painting staff.",
      },
      {
        id: "less-opaque-colours",
        appliesTo: "all",
        text: "Some white's, and accent colours are inherently less opaque and may require more than two coats of paint to achieve a satisfactory and uniform appearance.  Therefore, using these colours may require additional costs.  If these colours are selected, customers will be notified before work begins in that area",
      },
      {
        id: "interior-cleanup",
        appliesTo: "interior",
        text: "For interior projects - A “contractor grade” clean up will be performed at the end of every project. Clients understand that a deep clean is recommended in most cases outside of this agreement as dust spreading throughout the home may occur.",
      },
      {
        id: "house-access",
        appliesTo: "exterior",
        text: "Access to the house may be required during various stages of an exterior painting project. (ie painting doors)  Coordination of access will be organized by management prior to project commencement.",
      },
      {
        id: "roof-access",
        appliesTo: "exterior",
        text: "For exterior projects - Access to your roof may be required to complete some or all of the above work.  Grandview Painting Ltd. will commit to limit the wear and tear to the roof in those areas but cannot guarantee no wear and tear.",
      },
    ],
    warranty: {
      title: "Warranty",
      intro:
        "Subject to the limitations set forth below, for a period of {warrantyMonths} months from the date of completion of the work described on the contract or proposal, Grandview Painting (the “Contractor”) will repair peeling, blistering or chipping paint resulting from defective workmanship. For this warranty to be valid, you must:",
      conditions: [
        "Pay the full contract",
        "Retain a copy of the original contract",
        "Make the property accessible to the Contractor, or his employees, to perform the work",
      ],
      exclusionsLeadIn: "This limited warranty does not cover:",
      exclusions: [
        { id: "materials-not-supplied", appliesTo: "all", children: [], text: "Any work where the Contractor did not supply the paint or other materials." },
        { id: "work-not-performed", appliesTo: "all", children: [], text: "Any work not performed by the contractor" },
        { id: "varnished-work", appliesTo: "all", children: [], text: "Varnished work" },
        { id: "galvanized", appliesTo: "all", children: [], text: "Surfaces made of, or containing, galvanized materials" },
        {
          id: "horizontal-surfaces",
          appliesTo: "all",
          children: [],
          text: "Repairs to horizontal surfaces or any surface that, by virtue of its design permits moisture to collect.",
          note: "Surfaces include, but are not limited to, decks, railings, stairs, porches, roofs, and skylights",
        },
        { id: "exact-match", appliesTo: "all", children: [], text: "Exact paint match as environmental conditions will affect the color and finish of all paints over time" },
        {
          id: "paint-defect",
          appliesTo: "all",
          children: [],
          text: "Any repairs which are necessitated as a result of a defect in the paint regardless of whether the paint was supplied by the Contractor or the client",
        },
        { id: "bleeding", appliesTo: "all", children: [], text: "Bleeding caused by knots, rust etc" },
        { id: "cracks", appliesTo: "all", children: [], text: "Cracks in drywall, plaster or other surfaces." },
        {
          id: "peeling-causes",
          appliesTo: "all",
          text: "Peeling, blistering or chipping where they are caused by:",
          children: [
            "mill-glazing",
            "ordinary wear and tear",
            "abnormal use",
            "peeling of layers of paint existing prior to the work performed by the contractor",
            "Structural failure",
            "settling",
            "moisture content of the surface",
            "abrasion, mechanical damage, abrasive cleaning, abuse, or damage resulting from use of chemicals or cleaning agents or exposure to harmful solids, liquids or",
            "damage or defects caused in whole or in part by reason of fire, explosion, flood, acts of God, extreme weather conditions, misuse, alterations, abuse, vandalism, negligence, or any other similar causes beyond the control of the contractor",
          ],
        },
      ],
      closing: [
        "Repairs under this warranty will be performed only on the specific areas where peeling, blistering or chipping has occurred.",
        "This warranty is the only expressed warranty made by the contractor and is in lieu of all other warranties, expressed or implied. This warranty covers only those services provided by the contractor to the original purchaser named on the front of the contract or proposal. In no event shall the contractor be liable for incidental or consequential damages or damages in excess of the original contract price. This warranty may not be altered or extended for any purpose unless done so in writing in a document executed by all parties to the contract",
      ].join("\n\n"),
    },
    qualityStandards: {
      title: "Quality Standards & Surface Preparation",
      items: [
        {
          id: "pca-standards",
          appliesTo: "all",
          text: "All work will be done as per standards of the PCA (Painting Contractors Association). Standards are available for review by request or at the following link: {pcaStandardsUrl}",
        },
        {
          id: "properly-painted-surface",
          appliesTo: "all",
          text: "As per PCA: The painting contractor will produce a “properly painted surface”. A “properly painted surface” is one that is uniform in color and sheen. It one that is free of foreign material, lumps, skins, sags, holidays, misses, strike-through or insufficient coverage. It is a surface that is free of drips, spatters, spills, or over-spray, which the contractors’ workforce causes. Compliance to meeting the criteria of a “properly painted surface” shall be determined when viewed without magnification at a distance of five feet or more under normal lighting conditions and from a normal viewing position.",
        },
        {
          id: "prep-scope",
          appliesTo: "all",
          text: "The scope of preparation work will be specified on the proposal. Grandview Painting Ltd. is not required to perform any preparation work not specified on the proposal.",
        },
        {
          id: "exterior-failing-paint",
          appliesTo: "exterior",
          text: "For exterior projects, the industry standard for preparing areas with failing paint is scraping away loose and flaking paint then feather sanding the edges so they are not as noticeable (ridges may be more noticeable with multiple coats or layers of paint on the substrate). After sanding, any dust is wiped away and a coat of primer is applied to areas where the surface is bare. If more extensive preparation is desired (re-finishing), this must be discussed at the time of the estimate (PCA standard 5.4.2.).",
        },
      ],
    },
    paintsMaterials: {
      title: "Paints/Materials",
      items: [
        { id: "materials-included", appliesTo: "all", emphasis: false, text: "The estimate provided by Grandview Painting includes the cost for paint and other materials." },
        {
          id: "choose-colours",
          appliesTo: "all",
          emphasis: false,
          text: "Customers must choose colors prior to the project start date. Additional charges may apply if the customer changes colors after work begins.",
        },
        { id: "two-coats", appliesTo: "all", emphasis: false, text: "All surfaces will receive two (2) coats of paint (unless stated otherwise on the estimate)" },
        {
          id: "accent-colours",
          appliesTo: "all",
          emphasis: true,
          text: "Please Note: Some accent colors are inherently less opaque and may require more than two coats to achieve a satisfactory and uniform appearance. Therefore, using these colors may result in additional costs. If these colors are selected, customers will be notified before work begins in that area.",
        },
      ],
    },
    unforeseen: {
      title: "Unforseen Conditions",
      body: "If any unforeseen repairs arise, the customer will be notified, and an additional work order will be written up for the customer to sign for.",
    },
    customerResponsibility: {
      title: "Customer Responsibility",
      items: [
        { id: "site-clean", appliesTo: "all", text: "The job site must be clean prior to our painters arriving." },
        { id: "wall-hangings", appliesTo: "interior", text: "Wall hangings must be removed prior to project start." },
        { id: "no-other-trades", appliesTo: "all", text: "The work area must be free of other trades." },
        { id: "walk-through", appliesTo: "all", text: "The customer must be available on the last day of the project for a thorough walk-through with the crew lead." },
      ],
    },
    insurance: { title: "Insurance", body: "Please see our insurance information provided." },
    acceptance: {
      title: "Acceptance",
      items: [
        "Please indicate your acceptance of this estimate by clicking the “Accept” button and virtually signing.",
        "By accepting this contract, you acknowledge that you have read and understood the terms of this proposal.",
      ],
    },
    payment: {
      title: "Payment",
      items: ["Customer must pay {depositPct}% deposit of total estimate price upon acceptance of estimate.", "The remainder of the total will be paid upon completion of the project."],
    },
  },
  nextStep: {
    banner: { title: "Next Step", subtitle: "HOW TO PROCEED" },
    image: null,
    heading: "HOW TO PROCEED",
    steps: [
      "Sign below by typing your name and hitting 'Accept'.",
      "We'll be in touch with you to schedule a Job at suitable time.",
      "You can also contact us if you have any questions.",
    ],
    totalLabel: "ESTIMATE TOTAL",
    acceptLabel: "Accept",
    declineLabel: "Decline",
    agreeLabel: "I agree to the Terms and Conditions",
  },
  jobTypes: {
    default: {
      label: "painting",
      inherits: "default",
      scopes: [],
      cover: { headline: "{firstName}, thank you for considering Grandview Painting", intro: "", heroImage: HERO_EXTERIOR },
      portfolio: PORTFOLIO_MIXED,
      insuranceImage: CREW_EXTERIOR,
      faqImage: FAQ_CREW,
      areasListMode: "areas",
      areasExcludedDefault: "",
      servicesInclude: { title: "Services Include", body: "All the above quality labour & materials included. GST is shown separately in the totals below." },
      warrantyMonths: 24,
    },
    interior: {
      label: "interior",
      inherits: "default",
      scopes: ["interior"],
      cover: {
        headline: "{firstName}, it's what's inside that counts",
        intro:
          "Whether the interior of your home doesn’t suit your personal style, isn’t aligned with current trends, or maybe is just feeling a little run down, a quality paint job can make all the difference. Our painters have the experience and expertise to give your home the refresh it needs!",
        heroImage: HERO_INTERIOR,
      },
      portfolio: PORTFOLIO_INTERIOR,
      insuranceImage: CREW_INTERIOR,
      areasListMode: "areas",
      warrantyMonths: 24,
    },
    exterior: {
      label: "exterior",
      inherits: "default",
      scopes: ["exterior"],
      cover: EXTERIOR_COVER,
      portfolio: PORTFOLIO_EXTERIOR,
      insuranceImage: CREW_EXTERIOR,
      areasListMode: "surfaces",
      warrantyMonths: 36,
    },
    interior_exterior: {
      label: "interior & exterior",
      inherits: "default",
      scopes: ["interior", "exterior"],
      cover: EXTERIOR_COVER,
      portfolio: PORTFOLIO_MIXED,
      warrantyMonths: 24,
    },
    cabinets: { label: "cabinet", inherits: "interior", scopes: ["interior"] },
    staining: { label: "staining", inherits: "exterior", scopes: ["exterior"] },
    commercial: { label: "commercial", inherits: "default", scopes: [] },
    strata: { label: "strata", inherits: "default", scopes: [] },
    repairs: { label: "repair", inherits: "default", scopes: [] },
  },
};

/** Text we wrote or changed (Settings → Proposals → Overview shows these for review). */
export const SUGGESTED_NOTES = [
  { id: "intro-closing-job-type", kind: "changed", text: "The cover thank-you line uses {jobTypeLabel} instead of the hard-coded “interior”." },
  { id: "areas-line-number", kind: "changed", text: "“Any other area not listed in line #” now gets the real line number." },
  { id: "option-chip", kind: "changed", text: "Optional lines show a live “Not yet included / Added” chip instead of “(not yet included)”, because customers can add them." },
  { id: "services-include-gst", kind: "changed", text: "Services Include: “GST not included.” → “GST is shown separately in the totals below.”" },
  { id: "message-attached", kind: "changed", text: "Default message: “Terms and Conditions are attached.” → “…are included below.”" },
  { id: "paints-callout", kind: "changed", text: "“Please Note: …” in Paints/Materials is shown as a highlighted callout." },
  { id: "insurance-link", kind: "changed", text: "Contract “Insurance” now links to the Insurance section." },
  { id: "reviews-all", kind: "changed", text: "All four reviews start as “Show on: all job types”, as in Markate (three describe exterior work)." },
  { id: "default-headline", kind: "suggested", text: "Headline for other job types: “{firstName}, thank you for considering Grandview Painting”." },
  { id: "new-banners", kind: "suggested", text: "Banners “Your Project / YOUR CUSTOMIZED ESTIMATE”, “Terms & Conditions / THE DETAILS OF OUR AGREEMENT”, “Next Step / HOW TO PROCEED”." },
  { id: "deposit-label", kind: "suggested", text: "Totals label “Deposit due on acceptance”." },
] as const;
