# Presttige Photo Upload Flow

## End-to-End Flow

1. The Step 2 access form submits applicant data to `submit-access`.
2. On successful Step 2 submission, the browser opens the photo upload modal.
3. The browser validates selected files locally and converts HEIC/HEIF to JPEG client-side with `heic2any@0.0.4`.
4. The browser calls `POST /photo-upload-init` with `lead_id`, `content_type`, `file_size`, and optional tester flag.
5. `presttige-photo-upload-init` returns a pre-signed S3 POST for the originals bucket and seeds the `photo_uploads` map in DynamoDB.
6. The browser uploads the photo directly to S3 and then polls `GET /photo-upload-status`.
7. S3 `ObjectCreated` events invoke `presttige-thumbnail-generator`.
8. `presttige-thumbnail-generator` uses Sharp from the shared Lambda layer to create `400` and `1200` JPEG thumbnails in the thumbnails bucket.
9. The thumbnail Lambda updates `presttige-db` with `status=ready`, thumbnail keys, and `processed_at`.
10. `presttige-photo-upload-status` returns readiness plus a CloudFront thumbnail URL to the browser.
11. The modal enables continuation once at least 2 photos are ready, then forwards the applicant to `thank-you.html`.

## API Endpoints

### `POST /photo-upload-init`

Request body:

```json
{
  "lead_id": "fdm_...",
  "content_type": "image/jpeg",
  "file_size": 1234567,
  "is_test": false
}
```

Response:

```json
{
  "photo_id": "hex",
  "upload_url": "https://presttige-applicant-photos.s3.amazonaws.com/",
  "upload_fields": {},
  "key": "fdm_x/original/hex.jpg",
  "expires_in": 300
}
```

### `GET /photo-upload-status`

Query params:

- `lead_id`
- `photo_id`

Response:

```json
{
  "photo_id": "hex",
  "status": "ready",
  "thumbnail_url": "https://d2arhx2eclkhy0.cloudfront.net/...",
  "original_key": "fdm_x/original/hex.jpg"
}
```

## DynamoDB Schema Additions

B2 uses the existing `presttige-db` table and adds a `photo_uploads` map on each lead item.

Per photo entry:

- `status`
- `original_key`
- `content_type`
- `file_size`
- `retention`
- `created_at`
- `thumbnails`
- `processed_at`

This keeps uploads append-only per `photo_id` without requiring a table migration.

## Lambda Layer

- Layer name: `presttige-image-processing`
- Runtime target: `nodejs20.x`
- Architecture: `x86_64`
- Source: public prebuilt `pH200/sharp-layer` release
- Purpose: provide `sharp` to `presttige-thumbnail-generator` without local native builds

## Frontend Integration

- CSS: `/assets/css/photo-upload-modal.css`
- JS: `/assets/js/photo-upload-modal.js`
- Global API:
  - `window.PhotoUploadModal.open({ leadId, isTest, onComplete })`
  - `window.PhotoUploadModal.close()`
  - `window.PhotoUploadModal.getPhotoIds()`

The Step 2 form opens the modal immediately after successful form submission. Closing the modal does not delete already-uploaded photos, and reopening resumes the same in-memory session for the same `lead_id`.

## Tester Mode

The modal forwards `is_test` to `presttige-photo-upload-init`.

Server-side behavior:

- tester uploads are tagged with `retention=tester`
- lifecycle expiration remains 7 days from B1
- DynamoDB tracking still works for polling and thumbnail readiness

## Accepted Formats

- JPEG
- PNG
- HEIC / HEIF via browser-side conversion to JPEG

Server-side upload policies accept only `image/jpeg` and `image/png`. HEIC support is therefore implemented on the client rather than in Lambda.
