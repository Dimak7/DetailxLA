# Facebook quote forms

`/admin/leads` contains a separate Facebook form connection. It is independent of the ads_read reporting token. Save a Page ID, an explicit allowlist of quote form IDs, a Page access token with lead retrieval access, and the Meta app secret. Credentials are encrypted with SETTINGS_ENCRYPTION_KEY. The generated verify token is shown only to marketing administrators for webhook setup.

In the Meta app, add Capture & manage ad leads, configure the Page leadgen webhook using `/api/webhooks/meta-leads`, and subscribe the intended Facebook Page to the app. Grant the required Page/lead permissions and lead access for that Page. Real customer delivery may require app review/advanced access; a development test alone does not prove production eligibility. Use Meta's Lead Ads Testing Tool and verify the CRM lead and Telegram message before calling the connection active.

The webhook checks the SHA-256 signature over the exact request bytes and only queues leads matching the Page and form allowlist. Lead IDs deduplicate retries. Server retrieval confirms the returned lead ID and form ID before importing. Every submitted field and the full returned payload are retained; the import does not create promotional-message consent or send messages to the prospect.

Imported leads receive origin=meta, the Business Meta attribution stream, campaign/ad IDs, and a Call Customer flag. Missing email/phone fields are allowed and visibly remain missing. The tag clears when staff saves the lead as contacted/booked/won/lost, and is independently editable. Source attribution is retained when converting into a customer/booking. Telegram uses the existing configured business group and Bookings topic, with an outbox dedupe key per Meta lead.

Webhook receipt is durable before acknowledging Meta. Imports retry with backoff through the worker, authenticated `/api/jobs`, or the admin connection status request. Run the existing worker continuously or call `/api/jobs` on a schedule for unattended retry guarantees. Delivery failures stay queued with a generic error, without exposing tokens or provider payloads in logs. Viewing the Leads page also attempts due imports.

This imports new submitted leads after subscription; historical backfill is not automatic. Configuration is labelled configured, never verified/live solely because credentials were saved.
