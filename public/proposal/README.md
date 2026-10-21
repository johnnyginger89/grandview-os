# Default proposal images

Starter pictures for the customer proposal, taken from Grandview's own Markate
proposal template (re-encoded, metadata stripped). The owner replaces any of them
in Settings → Proposals; uploads are stored in the database (`media` table) and
these files stay as the fallback defaults.

Provenance key:
- **grandview-own**: Grandview job, crew or event photo (Grandview signage, uniforms or staff visible).
- **confirm-rights**: probably a Grandview job, but looks like real-estate photography. The owner must confirm Grandview holds the rights before relying on it ([OWNER-Q 11]).
- **third-party-licence**: icon art that looks like a stock/icon-library set (Flaticon/Freepik style). The owner must confirm a licence or attribution requirement ([OWNER-Q 11]).

| File | Used for | Provenance |
|---|---|---|
| hero-interior.jpg | Cover photo, interior job types | confirm-rights |
| hero-exterior.jpg | Cover photo, exterior and other job types | grandview-own |
| about-good-hands.jpg | About: "You're in good hands" | grandview-own |
| about-history-chamber.jpg | About: "Our History. Our Mission." | grandview-own |
| insurance-crew-interior.jpg | Insurance block, interior job types | grandview-own |
| insurance-crew-exterior.jpg | Insurance block, exterior and other job types | grandview-own |
| faq-crew.jpg | FAQ block | grandview-own (a past client's house number by the door is blurred) |
| portfolio-interior-01 … 06.jpg | Portfolio, interior | confirm-rights |
| portfolio-interior-07 … 09.jpg | Portfolio, interior | grandview-own |
| portfolio-exterior-01 … 06.jpg | Portfolio, exterior | grandview-own |
| portfolio-exterior-07 … 08.jpg | Portfolio, exterior | confirm-rights |
| why-*.png (6 icons) | "Why us" tiles | third-party-licence |

Not shipped on purpose: the Markate insurance certificate (the owner uploads the
current one), a stock-looking brush texture, review/social glyphs (rendered as
inline SVG instead) and any customer site photos.
