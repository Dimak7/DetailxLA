# West Loop Auto Spa Business OS Contract

## Existing source-of-truth records

| Domain | Current records | Existing relationship |
| --- | --- | --- |
| CRM | `customers`, `vehicles`, `leads`, `timeline`, `consent_events`, `crm_tags` | A customer owns vehicles, bookings, communications, consent, and activity. |
| Work | `bookings`, `services`, `blocks` | A booking stores the historical service snapshot, agreed `price_cents`, schedule, status, notes, and assigned user. |
| Crew | `employees`, `employee_job_assignments`, `employee_shifts`, `time_entries` | Shift scheduling, job allocation, and clocked time are independent records. |
| Payroll | `pay_periods`, `payroll_records`, `payroll_adjustments` | Payroll is calculated from paid time, completed booking price, allocation split, tips, and adjustments. |
| Financials | `payments`, `expenses`, `ad_spend` | Payments are collections; booking price is the final completed job value used for job commission. |
| Inventory | `inventory_items`, `inventory_movements` | Stock and cost changes are transaction backed. |
| Growth | `attributions`, `campaigns`, `messages`, `events`, `reviews` | Acquisition metadata follows customer and booking records without duplicating CRM records. |

## Financial definitions

- **Completed job value:** `bookings.price_cents` on a completed booking. This is historical and is not changed by later service catalog pricing.
- **Collected payments:** paid payment amounts less refunds. This is cash collection, not automatically service revenue.
- **Tips:** `bookings.tip_cents`; never part of commissionable job value.
- **Detailer commission pool:** 30% of completed job value. Employee allocations in `employee_job_assignments` must total 100%.
- **Paid hours:** actual completed time entries when present for the period; otherwise scheduled shift hours, explicitly labelled as a fallback.
- **Estimated payroll:** hourly earnings plus allocated commission, tips, and payroll adjustments.
- **Operating expenses:** recorded expense rows, including linked inventory purchases only once.

## Extension rules

1. Add job operations as an extension of a booking; do not introduce a second customer, vehicle, payment, or employee identity.
2. Add discounts, upsells, taxes, and payment fees as immutable transaction details tied to a booking/job. Historical completed values must remain auditable.
3. Square sync must be idempotent, log every webhook, and map external payments to existing booking/customer records without inferring ordinary operating expenses.
4. Inventory consumption can be linked to a completed job only when a material usage rule exists; otherwise the cost remains unknown, not estimated as actual.
5. Dashboard and reports must use these definitions and link to underlying records for drill-down.
