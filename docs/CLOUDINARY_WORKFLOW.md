# Cloudinary preparation

Prepared for product images and company logos. **No upload UI, signing endpoint, provider connection, or remote deletion is active.** Existing HTTPS image URLs continue to work. Adding environment variables alone does not turn uploads on; the authenticated MongoDB/API integration must be connected first.

## Included now

- `src/lib/cloudinary-media.ts`: optional asset metadata, canonical URL checks, image limits, and safe retention when a catalog URL is edited.
- `src/lib/catalog-media-contract.ts`: target/submission types, scoped upload plans, prepared-file checks, and provider-response parsing. These are pure helpers with no network calls. Structural checks do not establish ownership or authenticate an upload response.
- `CatalogSaveRequest.imageUpload`: a temporary submission ID/token pair for a future save endpoint. The server attaches verified metadata; callers do not supply trusted asset IDs.
- `.env.example`: server credential placeholders. Real values belong in ignored `.env.local` or deployment secret settings. Never use `NEXT_PUBLIC_` for credentials. Cloudinary explicitly requires keeping the [API secret out of client-side code](https://cloudinary.com/documentation/upload_images#authenticated_requests).

## Data model

Products keep `imageUrl` and optional `imageAsset`; companies keep `logoImageUrl` and optional `logoAsset`. Metadata contains `provider`, `cloudName`, immutable `assetId`, `publicId`, `version`, `format`, `width`, `height`, and `bytes`. No credentials, signatures, staging tokens, or file contents enter the workspace or JSON backup.

Store canonical, versioned HTTPS originals under `res.cloudinary.com`. Any later display transformation should be derived separately. Managed images initially support JPEG (`jpg`), PNG, and WebP, up to 5 MiB and 4,096 pixels per dimension. SVG, GIF, video, private delivery, and custom Cloudinary delivery domains need an explicit extension of this contract. These restrictions apply to managed uploads, not existing external URL-only records.

Ordinary name/order/owner edits retain matching asset details. A manually replaced or cleared URL detaches the old metadata but performs no remote deletion. Pasting a Cloudinary URL does not prove ownership and never creates metadata automatically. The server must track old asset references in its media ledger when a managed image is replaced.

Active browser storage is v8. Legacy catalogs migrate intact, with no invented media ownership; earlier keys remain recovery copies. Use the upgraded app in all tabs before editing. JSON backups preserve metadata and Trash, but are not a backup of image files. Restored metadata must be rechecked against authenticated ownership records before any remote cleanup.

## Workflow to wire when the API is ready

1. **Choose and prepare locally.** Show a local preview and original/prepared file sizes. Preserve aspect ratio and transparency; target a 1,600-pixel product image or 512-pixel logo without upscaling. Try WebP first with minimal visible quality loss; retain PNG or JPEG if conversion is unsupported or not beneficial. Keep prepared files in editor state; selection and Cancel must never upload. Validate file contents/dimensions, not only MIME hints. Browser preparation and this UI remain to be connected.
2. **Save starts the submission.** Validate all text fields first. The server authenticates the user, authorizes the workspace and target, checks revision/quotas, and records a unique submission ID and payload/file digest. Use one submission for retries of the same data; changing the file or text after failure starts a new submission.
3. **Issue a signed upload plan.** Call `planCatalogImageUpload` with server-controlled cloud/folder settings and authorized IDs. The public ID is `folder/workspaceId/products-or-companies/recordId/submissionId`. Set `resource_type: image`, `type: upload`, `overwrite: false`, and allow only `jpg,png,webp`. Do not sign caller-provided folders, public IDs, transforms, URLs, or arbitrary options. Use the official server SDK after authentication is implemented. Cloudinary documents [allowed formats, public IDs, and overwrite behavior](https://cloudinary.com/documentation/image_upload_api_reference#upload).
4. **Upload, then verify.** Prefer a signed direct upload of the prepared bytes to avoid sending a large multipart body through the application server. Bind authorization to user, workspace, target, submission, and digest. Enforce provider/account upload limits and verify stored bytes, format, dimensions, cloud, asset ID, and expected public ID on the server before accepting the result. A browser response or MIME type alone is not evidence. Parse verified metadata with `parseCloudinaryUploadMetadata`, record it as staged, and issue a short-lived application token. The application token is separate from Cloudinary's signature.
5. **Commit text and image together.** Send the small catalog JSON plus `imageUpload: { submissionId, uploadToken }`. Verify token expiry/bindings and that the staged URL is the URL being saved. In the MongoDB transaction, enforce the expected revision and write the catalog record, committed media reference, and idempotent operation result together. Show success only after the commit is confirmed. A record with an unchanged managed URL may retain its existing verified metadata; a new arbitrary HTTPS URL stays unmanaged.

Signed upload expiration does not itself implement one-time application submissions. Keep a server submission ledger and reject replayed tokens bound to other targets or different payloads. `overwrite: false` avoids replacing a previous asset; an existing-asset response must be reconciled with the original submission before reuse.

`CLOUDINARY_UPLOAD_FOLDER` is an application public-ID prefix. The plan already includes it in `publicId`; do not prepend it again when mapping the plan to Cloudinary's upload parameters.

## Retry and cleanup rules

- Use a small configurable number of user-triggered retries per stage (default two retries). Keep form values and prepared files visible throughout.
- Upload failure: do not save the catalog record. Resolve an uncertain upload by its scoped public ID/submission before retrying. Retain any successful uploads.
- Database failure: reuse verified uploads/tokens when retrying the same save; do not upload again. If the response was lost, query the operation outcome before deciding it failed. Refresh expired application tokens only after server verification.
- Keep staged asset ownership, committed references, replacement candidates, and cleanup outcomes in a durable server media ledger. No Cloudinary cleanup is authorized merely by restoring client JSON or comparing image URLs.
- Only after a failed outcome is confirmed may rollback remove newly uploaded assets from that submission, within the application's owned folder, after checking every live and Trash reference. Resolve shared assets and URL-only references conservatively; keep anything uncertain.
- Never delete a saved image when a record enters Trash. Retain it through restoration and the 30-day period. Pruning local records does not call Cloudinary.
- Add an authenticated manual Cleanup action when the backend exists. It should show confirmed unreferenced candidates, use idempotent deletion, retain failed cleanup entries, and coordinate with saves so a reference cannot appear between check and delete. No background media cleanup is planned.
- For approved permanent deletions, request CDN invalidation. Cloudinary explains that [deleting an asset and invalidating cached copies are separate concerns](https://cloudinary.com/documentation/delete_assets).

## Enablement checklist

Provide the cloud name, API key, API secret, and signed upload preset through server configuration. Then implement authentication, submission storage, signing/verification, operation-status queries, transactional MongoDB saves, browser image preparation/progress, and authorized cleanup before showing Upload controls. Test upload failure, uncertain responses, expired tokens, changed inputs on retry, cross-workspace access, shared images, and Trash restoration against a dedicated test cloud. No live Cloudinary behavior has been verified in this preparation step.
