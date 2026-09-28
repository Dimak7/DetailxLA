# Telegram booking alerts

Every public booking request queues a Telegram alert for the business. The alert includes:

- Customer name and phone
- Service and vehicle
- Appointment date and time
- Current estimate
- Marketing source
- Secure admin workspace link

## Required configuration

Only these two values are required for outbound booking alerts:

- `TELEGRAM_BOT_TOKEN`: token issued by BotFather.
- `TELEGRAM_CHAT_ID`: the private chat or group that should receive alerts.

They can be stored as Railway variables or entered in Admin, Settings, Notifications. Admin-stored credentials are encrypted.

## Bot setup

1. Create the bot with BotFather and keep the token private.
2. Open the new bot and send it `/start`.
3. For a group, add the bot to the group and send a message in that group.
4. Resolve the target chat ID from Telegram's `getUpdates` response.
5. Save the bot token and chat ID.
6. Open Admin, Settings and click **Send Telegram test**.
7. Create a test booking and verify that exactly one booking alert is received.

## Optional commands

The application also supports `/today` and `/tomorrow`. These require a Telegram webhook pointed to:

`https://detailxla-production.up.railway.app/api/telegram`

Set a random `TELEGRAM_WEBHOOK_SECRET` and use the same value as Telegram's webhook `secret_token`. This webhook is optional for outbound booking alerts.

