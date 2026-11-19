# Cloudinary catalog images

The Products and Companies editors accept JPEG, PNG and WebP files when connected to MongoDB. Select a file to prepare and preview it in the browser. Save uploads the prepared image and then commits the catalog record. Existing HTTPS image URLs continue through the same verified Cloudinary storage workflow. Carrier PDFs follow the private order-label storage workflow.

## File uploads and retries

- The browser accepts still images up to 32 MiB and 50 megapixels. It preserves aspect ratio and transparency and prepares images up to 1,600 pixels on the longest edge for products or 512 pixels for logos.
- The local API validates the file, assigns a scoped public ID, and verifies the result with Cloudinary. The MongoDB transaction records the image reference and marks the upload committed together.
- A failed upload keeps the prepared image for retry. A failed record save can reuse the verified upload. The editor keeps the draft while either step is retried.
- **Settings > Unused image uploads** removes abandoned staged uploads after an hour. Cleanup verifies recorded ownership and checks current references, including Trash, before removing eligible files. Committed uploads remain available for older backups.

## Server configuration

Keep the cloud name, API key, API secret, upload preset and folder in the server environment. The variable names are in `.env.example`. The API credentials need permission to read the preset, upload images and retrieve asset details. [Cloudinary authenticated uploads](https://cloudinary.com/documentation/upload_images#authenticated_requests)

Use a signed preset with overwrite disabled and allow JPEG, PNG and WebP. Leave public ID prefixing disabled in the preset. The preset's **Asset folder** organizes images in the Cloudinary Media Library. The app uses `CLOUDINARY_UPLOAD_FOLDER` when it builds each public ID. For the bundled PNG, preserve the original bytes by leaving incoming transformations disabled. [Cloudinary upload presets](https://cloudinary.com/documentation/upload_presets)

## Migration and verification

1. The server reads the configured preset. For each new image it builds a public ID from the configured folder, workspace, collection, record and a SHA-256 digest. For a bundled image the digest covers the file bytes. For an external image it covers the source URL.
2. The server checks Cloudinary for that public ID. If it needs to upload an image, it signs a request with `overwrite=false`. Cloudinary retrieves external HTTPS images. Local file reads are limited to the app's list of bundled catalog images.
3. The server reads the asset back through the authenticated Admin API. It verifies the source marker, expected public ID, canonical versioned URL, file format, dimensions and byte count. Managed images can be up to 5 MiB and 4,096 pixels on either edge. For the bundled image it also downloads the delivered original and compares its SHA-256 digest with the local PNG.
4. MongoDB stores the verified URL and metadata in `imageUrl` and `imageAsset` for products, or `logoImageUrl` and `logoAsset` for companies. On subsequent saves, the server can reuse the verified metadata for an unchanged URL. [Cloudinary Admin API](https://cloudinary.com/documentation/admin_api)

A verification failure stops the database commit. If a response is lost or the database write fails, retrying the same source looks up its existing upload. The accepted workspace keeps its earlier image references until the new commit succeeds. The app retains originals and assets referenced by Trash. Keep the bundled PNG for existing local workspaces and the starter product.

The server implementation is in `src/lib/server/workspace-media.ts`. Regression coverage includes interrupted uploads, byte mismatches, saved-image reuse and a failed external image fetch in `tests/workspace-media-migration.test.ts`.
