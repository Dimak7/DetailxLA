# Square payments

The booking flow uses Square-hosted Checkout. Card data is entered on Square and is never sent to this application.

## Railway variables

Set these on the production service:

- `SQUARE_ENVIRONMENT`: `sandbox` for Square sandbox credentials, or `production` for live credentials. The default is `production`.
- `SQUARE_ACCESS_TOKEN`: Access token from the selected Square environment.
- `SQUARE_LOCATION_ID`: Location from the selected Square environment that should receive booking deposits.
- `SQUARE_WEBHOOK_SIGNATURE_KEY`: Signature key for the webhook subscription in the selected Square environment.
- `SQUARE_WEBHOOK_URL`: `https://detailxla-production.up.railway.app/api/webhooks/square`
- `BOOKING_DEPOSIT_PERCENT`: `50`

All three Square credentials must be present before public checkout is enabled.

## Square webhook

Create a webhook subscription in the same environment as the credentials with this notification URL:

`https://detailxla-production.up.railway.app/api/webhooks/square`

Subscribe to:

- `payment.created`
- `payment.updated`
- `refund.updated`

The notification URL in Square and `SQUARE_WEBHOOK_URL` must match exactly because Square includes it in webhook signature validation.

## Booking behavior

- Standard fixed-price and starting-price details collect the configured deposit.
- Ceramic coating and services marked as quote-based create a request without charging a card.
- A checkout redirect does not confirm payment.
- Only a signature-verified completed-payment webhook marks a payment paid and changes a new booking to confirmed.
- Completed Square refunds update the payment ledger and financial reports.
