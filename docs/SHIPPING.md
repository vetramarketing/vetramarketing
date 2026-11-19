# Historical carrier labels and the local Flash connector

The current Orders page records recipient, carrier, and parcel details. Existing orders can retain historical sender, tracking, booking, and PDF metadata. Workspace backups still include referenced PDFs. The following sections document the optional local connector and its booking journal for existing integrations.

Automatic booking is currently implemented for Flash only. It is optional and
disabled by default. This build does not schedule pickup, collect online payments,
subscribe to carrier webhooks, or synchronize delivery status automatically.

## Local Flash setup

1. Obtain a Flash merchant ID and API key for the training environment through
   Flash's official support. Confirm the sender address and any COD entitlement
   with Flash. Do not paste credentials into chat, workspace exports, or UI fields.
2. Set the server-only variables from `.env.example` in `.env.local`:

   ```dotenv
   VETRA_LOCAL_SHIPPING_ENABLED=true
   VETRA_LOCAL_SHIPPING_ORIGIN=http://127.0.0.1:3100
   FLASH_API_MODE=training
   FLASH_MCH_ID=your-training-merchant-id
   FLASH_API_KEY=your-training-key
   ```

3. Restart the local app using `npm run dev`, or build and use `npm run start`.
   Both project commands bind to `127.0.0.1`. Use the exact configured origin in
   the browser. Keep the computer and local account access controlled.
4. Test a complete order using the training account. Training shipments remain
   marked as training in saved shipment metadata. Training labels are not live
   postage/shipping bookings.
5. Only after Flash authorizes the production account and an operator verifies
   the integration, configure production credentials and explicitly change
   `FLASH_API_MODE=production`. Creating a production shipment can incur carrier
   charges according to the merchant agreement. Use actual parcel information.

This gateway is not an authentication system for shared/public access. Keep
`VETRA_LOCAL_SHIPPING_ENABLED=false` on public hosting; never expose the local
server through a tunnel or a public reverse proxy. Shared/hosted booking needs an
authenticated, authorized backend and a durable transactional shipment store.
The local gateway requires the configured loopback URL/Host and exact same-origin
mutation requests; it refuses mismatched origins, hosts, and proxy headers.

## Booking and label API

All responses are uncached. Error bodies use `{ error: { code, message } }` and do
not include secrets or raw carrier responses.

| Local route                      | Request / response                                                          |
| -------------------------------- | --------------------------------------------------------------------------- |
| `GET /api/shipping/capabilities` | `{ enabled, configured, mode }`; no credentials                             |
| `POST /api/shipping/flash/book`  | JSON `{ order }`; returns `{ shipment, mode, reused }`                      |
| `POST /api/shipping/flash/label` | JSON `{ orderId, size: "100x180" \| "100x75" }`; returns original PDF bytes |

Booking returns `shipment` with `source: "flash-api"`, `trackingNumber`,
`requestId` (the local order ID), `bookedAt`, and `mode`. A caller must save that
shipment before requesting its PDF. A PDF retry does not book another shipment.
The label route only accepts an order that has a completed local booking record;
it cannot proxy arbitrary tracking numbers or URLs.

Sender and recipient must have complete Thai addresses. Parcel weight is entered
in grams; dimensions are whole centimetres. Monetary totals remain integer
satang. The initial adapter uses standard delivery, sender-paid freight, and no
optional insurance. COD is requested only when the order's payment method is COD;
its amount is the complete order total, with the item details attached. Unsupported
COD item counts are rejected before contacting Flash.

## Durable journal and uncertain results

The server keeps a private `.local-data/shipping/` journal, separately scoped by
training/production mode and merchant account. Keep it with the local app and
include it in secure local backups. Workspace JSON backups do not include this
server journal. Do not delete or reset it as ordinary troubleshooting.

Each order has one stable carrier reference. An exclusive directory and fsynced
intent file are created before the carrier request. The journal stores hashes,
references, timestamps, and returned tracking metadata; it does not copy names,
addresses, or API keys. Outcomes are immutable files with a separately fsynced
checksum commit marker. Readers reject incomplete or mismatched writes.

A repeated request with identical shipping details returns the saved shipment.
A simultaneous request, changed details after an attempted booking, process crash,
timeout, unreadable response, or uncertain failure cannot silently create another
parcel. Even carrier rejections remain recorded for review. No background or
automatic booking retries occur.

When an attempt needs reconciliation:

1. Keep the order and journal intact. Do not create a replacement order to bypass
   the warning while the carrier outcome is unknown.
2. Give the saved `outTradeNo` from that order's journal to Flash support or check
   the merchant portal. Confirm whether a parcel was created.
3. If it exists, retain its verified tracking and official PDF with the carrier record. Keep the local journal as evidence of the original attempt.
4. If Flash confirms no parcel exists and a new attempt is needed, retain that
   confirmation and have a developer review the local record. This release does
   not expose a one-click reset that could cause duplicate bookings.

If only label retrieval fails, use the label action again. The successfully
recorded shipment remains available and is not recreated.

## Verified official integration sources

The [Flash Open API reference](https://open-docs.flashexpress.com/) specifies
production `https://open-api.flashexpress.com` and training
`https://open-api-tra.flashexpress.com`. Creation uses `POST /open/v3/orders`;
PDF labels use `/open/v1/orders/{pno}/pre_print` (100×180 mm) or
`/open/v1/orders/{pno}/small/pre_print` (100×75 mm). The adapter uses only those
fixed hosts and does not follow redirects.

Signing follows the documented ascending-key, nonblank raw-parameter SHA256
algorithm before URL encoding, also verified against the linked official Python
demo. The digest displayed in the prose example does not match its shown inputs;
the tests check a recomputed vector following the formula. The documentation does
not specify a safe replay/lookup contract for recovering an unknown tracking
number from the merchant reference, so uncertain results require reconciliation.

No actual carrier account has been configured or exercised in this workspace.
Mocked tests verify request signing, request/response validation, original PDF
delivery, local-only access checks, durable intent recording, duplicate prevention,
ambiguous results, and label retry without rebooking. Live training and production
acceptance remain dependent on the user's authorized Flash account.
