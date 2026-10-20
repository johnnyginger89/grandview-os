# YouCanBook.me → Grandview OS

Bookings made through YouCanBook.me land in the **Estimate Booked** stage automatically.
If the person already has an open lead (for example, they filled in the website form and
you sent them the booking link), that lead is moved to Estimate Booked instead of creating
a duplicate. Customers are matched by email, then phone.

## Endpoint

```
POST https://<your-domain>/api/inbound/youcanbookme?key=<YCBM_WEBHOOK_SECRET>
Content-Type: application/json
```

`YCBM_WEBHOOK_SECRET` is a server environment variable. Treat the full URL like a password. If your webhook tool can send headers, send the secret as an `x-webhook-secret` header instead of `?key=`, so it never appears in request logs.

## Setting it up in YouCanBook.me

In your booking page settings, add a **webhook** notification for *new bookings*, and a
second one for *cancellations*. Set the method to POST, content type JSON, and use a body
like the template below. Replace each value with the matching YouCanBook.me placeholder for
your form fields. Placeholder names depend on how your booking form is set up, so check them
in YouCanBook.me's placeholder list. The field names on the left are what Grandview OS reads.

```json
{
  "event": "booked",
  "bookingId": "<booking reference placeholder>",
  "firstName": "<first name placeholder>",
  "lastName": "<last name placeholder>",
  "email": "<email placeholder>",
  "phone": "<phone placeholder>",
  "address": "<street address placeholder>",
  "unit": "<suite/unit placeholder>",
  "city": "<city placeholder>",
  "postalCode": "<postal code placeholder>",
  "projectTypes": "<project type placeholder>",
  "propertyType": "<property type placeholder>",
  "timeline": "<timeline placeholder>",
  "source": "<how did you hear about us placeholder>",
  "description": "<tell us about your project placeholder>",
  "startTime": "<booking start date-time placeholder, ISO format>",
  "manageUrl": "<manage/reschedule link placeholder>"
}
```

For the cancellation webhook, send the same `bookingId` with `"event": "cancelled"`.
The lead moves to **Lost** with reason "Booking cancelled".

Field names are matched loosely, so `first_name`, `fname` and `First Name` all work.
Multiple project types can be comma-separated.

## Reliability

- Every payload is stored in `inbound_events` before processing, so nothing is lost if
  processing fails. Failed events show the error and can be replayed.
- Re-sending the same booking reference and event is ignored, so retries are safe.

## Testing

```
curl -X POST "http://localhost:3000/api/inbound/youcanbookme" -H "x-webhook-secret: $YCBM_WEBHOOK_SECRET" \
  -H 'content-type: application/json' \
  -d '{"bookingId":"TEST-1","firstName":"Test","email":"test@example.com","startTime":"2026-11-01T17:00:00Z"}'
```

# Website form → New Lead

```
POST https://<your-domain>/api/inbound/form
x-webhook-secret: <FORM_WEBHOOK_SECRET>
```

The website form uses Gravity Forms, so post from the website **server** with the Gravity Forms Webhooks add-on, adding the secret as a request header. Never put the secret in browser-side code. Accepts JSON or a normal form post. Recognized fields: `name` (or `firstName`/`lastName`),
`email`, `phone`, `address`, `city`, `postalCode`, `service`/`projectType`, `message`, `source`.
An email or a phone number is required. Add a hidden empty field named `website_url` as a spam
honeypot: submissions that fill it in are silently dropped.

Leads land in **New Lead – To Contact**. Opening one shows the **Send booking link** button,
which previews and then emails your YouCanBook.me link (Settings → Company) using the
"New lead – book your estimate" template (Settings → Email templates).
