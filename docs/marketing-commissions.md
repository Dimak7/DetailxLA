# Marketing streams and commissions

Commission recipient: Dima. Only the customer's first completed job is eligible, regardless of how many services that appointment includes. A prior organic completed job makes later paid-campaign jobs repeat business. Match customers by customer ID, case-insensitive email, or normalized phone number (US +1 and ten-digit forms match). Missing or changed identities require human review; this cannot discover undisclosed historical work outside the database.

| URL lead_stream | Budget owner | Rate |
| --- | --- | --- |
| business-google | West Loop Ceramics | 10% |
| business-meta | West Loop Ceramics | 10% |
| dima-google | Dima | 25% |

Old Dima Leads / West Loop Leads labels are retained without automatically assigning either rate. No migration guesses historical ownership or creates retroactive payout obligations.

## Capture

Marketing provides reusable links. Use utm_source=google&utm_medium=cpc for Google or utm_source=meta&utm_medium=paid_social for Meta, plus lead_stream and a campaign-specific utm_campaign. Preserve the parameters when redirecting. Keep Google auto-tagging enabled. Quote/contact forms capture the same visitor attribution; converting the lead to a booking retains its original attribution. Direct return visits retain stored attribution for the existing 90-day window. An explicit different stream link replaces the browser's current stream with a new attribution session; commission approval confirms the source before payout. No model can establish a customer's source across unknown devices or deleted storage without identity/call evidence.

Phone/manual booking forms have an explicit stream selector. Use different call-tracking numbers per stream, forwarding to Dima, before claiming automatic call attribution. Call-provider credentials/numbers and external Google/Meta account reporting are not connected by this change. Meta instant forms require a separate integration or manual entry into Leads with the matching source/stream. Business-funded and Dima-funded ad spend should be entered under the matching stream; no expenditure is inferred from visits.

## Basis and approval

The basis is the booking's agreed service subtotal (price_cents), after discounts and excluding tax/tips. Require completed status and verified linked payments covering that subtotal before approval. Never use gross Square collections or estimated booking value as commission earnings. Extra collections cannot increase the subtotal cap. Refunds reduce the basis conservatively by the entire refund; a refund consisting solely of tax/tips still reduces commission until reviewed separately. Processor fees are not deducted from the service subtotal. Unknown quotes cannot earn commission.

An owner/admin must verify attribution, first-job eligibility and the tax/tip-free subtotal before approving. Approval snapshots stream, rate and maximum service basis. Later increases do not silently increase the approved obligation; refunds can decrease it. Fully collected refers to the service subtotal, not unrelated tax or tips.

## Payout records

Approval and recording an already-made payment are separate actions. Recording paid requires a transfer reference; it never sends money. Approvals/payouts have durable actor and timestamp records plus customer timeline entries. Serialized payout recording prevents two simultaneous clicks paying the same outstanding balance twice. Refunds or reopening a completed booking after payout produce negative adjustments while retaining payout history. These need reconciliation; the system does not debit the recipient automatically.

Marketing commission totals are lifetime totals for tagged bookings, independent of the page's channel-report date filter. Staff and managers cannot access the commission API. Employee detailing compensation is unchanged.
