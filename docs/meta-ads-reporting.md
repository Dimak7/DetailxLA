# Meta Ads reporting connection

Growth → Marketing → Ad account performance compares ad-platform spend/clicks/conversions with existing website enquiries/bookings and linked net collections. Business Meta is the business-funded 10% stream. Google integrations remain unconnected and never display assumed zero spend/clicks.

## Required access

Use the Meta ad account ID (act_…; not the Business ID or Pixel ID) and a user/system-user reporting access token authorized for that account with ads_read. Prefer read-only asset access and a durable system-user credential where the business supports it. Creating a system user/app, assigning assets, or granting new access must be completed/approved by the owner; do not infer access from a browser login. A Pixel/CAPI token does not automatically grant Ads Insights access.

Enter the token in the secure connection form, not chat. Saved tokens use the existing AES-256-GCM settings encryption key. META_ADS_REPORTING_TOKEN overrides a database-saved token. META_ADS_API_VERSION defaults to v26.0, configurable for supported API versions. Token values and raw provider errors are not returned to the client.

An explicit campaign scope is required: either confirm the ad account is dedicated exclusively to West Loop Ceramics or supply its campaign IDs. Never import another client's spend. In campaign-restricted mode, set utm_campaign to the exact Meta campaign ID (Meta's dynamic {{campaign.id}} parameter can fill this). Website data without a matching ID stays in an unmatched row and does not inflate campaign ROAS.

## Metrics and comparison definitions

Insights requests use campaign level, explicit inclusive dates, action_report_time=conversion and the ad account's attribution setting. Query only one selected action type (lead, purchase, or a specific website/instant-form event) so overlapping aggregate actions are not summed. Display all ad clicks and link clicks separately. Provider conversion value is labeled as reported value, never treated as collected cash.

Account currency must be USD; no conversion or mixing of currencies occurs. Meta dates use the account timezone; website dates use Central Time. The website columns retain existing report semantics: enquiries/bookings by creation date, collected revenue by payment date less refunds. These are period comparisons, not acquisition cohort lifetime ROAS. Website collections can include tips/tax; marketing commissions independently use agreed service subtotals.

## Synchronization

Successful complete snapshots are keyed by account/campaign/action scope and date range. All pages must succeed before replacing the last report. Pagination follows cursors on the official Graph host, not returned next URLs. Scope changes do not expose cached metrics from a different scope. Failed/expired-token refreshes retain the last successful data with a visible error and timestamp. No snapshot is "Not synced", not zero. A valid successful empty report is zero.

The page polls local status every 30 seconds. Authenticated GET queues a refresh with Next after when the last attempt is more than 15 minutes old; manual Sync is also available, with a one-minute per-scope/range cooldown and DB lock. This refreshes while the dashboard is in use; it is not an always-on scheduled importer. Snapshots are separate from manual ad_spend rows to avoid double-counting. Existing channel reports remain explicitly labeled manual spend.

All external calls read account metadata or Insights. The application does not edit ads, audiences, or budgets. Meta native form contact details require a separate leads_retrieval connection; the Insights lead count does not import people. Likewise this does not upload offline bookings/payment conversions to Meta.
