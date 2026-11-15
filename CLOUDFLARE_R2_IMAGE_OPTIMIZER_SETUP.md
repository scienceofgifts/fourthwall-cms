# Cloudflare R2, Cloudflare Images Binding & Bulk Product Image Optimizer Setup Guide

This document explains the required Cloudflare configuration for the **Science of Gifts Fourthwall Gift Guide CMS** Bulk Product Image Optimizer and R2 uploader.

---

## 1. Architecture Overview

- **Proportional WebP Conversion (No Cropping, No Upscaling)**:
  - **Cloudflare Workers (`workers.ts`)**: Uses the native Cloudflare Images binding (`env.IMAGES`, configured via `[images] binding = "IMAGES"` in `wrangler.toml`) with `fit: 'scale-down'` and `format: 'image/webp'`.
  - **Node.js Development Server (`server.ts`)**: Uses `sharp` (`fit: 'inside'`, `withoutEnlargement: true`, `alphaQuality: 100`).
  - Both pathways enforce identical optimization rules:
    - WebP output (`image/webp`)
    - `600px` standard maximum width / `900px` featured maximum width
    - Quality `80` (configurable in UI)
    - Original aspect ratio preserved (`fit: 'scale-down'` / `fit: 'inside'`)
    - No cropping and no upscaling of smaller images
    - Alpha transparency preserved
    - Existing gift-card CSS (`src/constants/lockedCss.ts`) is **never** modified.
- **Server-Side Firebase ID Token Authentication**:
  - `POST /api/images/upload-r2` requires a valid `Authorization: Bearer <firebaseIdToken>` header obtained from the signed-in Google user in the CMS (`auth.currentUser.getIdToken()`).
  - The server/Worker cryptographically verifies the RS256 JWT against Google's Secure Token public JWK set (`https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`), checks `aud` (`projectId`), `iss`, `exp`, `iat`, and `email_verified === true`, and restricts access to explicitly authorized CMS users (`DEFAULT_AUTHORIZED_CMS_EMAILS` / `DEFAULT_AUTHORIZED_CMS_UIDS` plus optional `CMS_AUTHORIZED_EMAILS` / `CMS_AUTHORIZED_UIDS`).
  - R2 credentials and shared secrets are **never** exposed to the browser.

---

## 2. Required Cloudflare Configuration

### Step 1: Cloudflare Images Binding (`IMAGES`)
`wrangler.toml` is already configured with the native Cloudflare Images binding:

```toml
[images]
binding = "IMAGES"
```

When deployed through your GitHub-to-Cloudflare workflow (`wrangler deploy`), Wrangler automatically binds Cloudflare Images to `env.IMAGES` on your Worker. Ensure **Cloudflare Images** is enabled on your Cloudflare account so the Worker can execute `env.IMAGES.input(...).transform(...).output({ format: 'image/webp', quality: 80 })`.

### Step 2: Cloudflare R2 Bucket & Custom Domain
1. In the **Cloudflare Dashboard** → **R2 Object Storage**, select your configured R2 bucket (matching your `R2_BUCKET_NAME` variable).
2. Under **Settings** → **Public Access** → **Custom Domains**, connect your custom domain (defaulting to `images.scienceofgifts.com` or your `R2_PUBLIC_BASE_URL`).
3. Any WebP file uploaded to `products/<slug>.webp` will be served at:
   ```text
   https://images.scienceofgifts.com/products/<slug>.webp
   ```
   with `Content-Type: image/webp` and `Cache-Control: public, max-age=31536000, immutable`.

### Step 3: R2 Upload Credentials (S3-Compatible API or Native R2 Bucket Binding)

Both R2 upload modes are supported:

- **Option A — S3-Compatible R2 API Variables (Configured in Worker Secrets / `.env`)**:
  ```bash
  R2_ACCOUNT_ID="your_cloudflare_account_id"
  R2_ACCESS_KEY_ID="your_r2_access_key_id"
  R2_SECRET_ACCESS_KEY="your_r2_secret_access_key"
  R2_BUCKET_NAME="your_configured_r2_bucket_name"
  R2_PUBLIC_BASE_URL="https://images.scienceofgifts.com"
  ```
  *(Note: If `R2_UPLOAD_AUTH_TOKEN` is still present in your environment variables, it does not need to be entered in the browser; authentication is now handled via verified Firebase ID tokens.)*

- **Option B — Native Worker R2 Bucket Binding (`IMAGES_BUCKET`)**:
  If you prefer binding the R2 bucket directly in `wrangler.toml`, uncomment `[[r2_buckets]]` and set `bucket_name` to your actual R2 bucket name:
  ```toml
  [[r2_buckets]]
  binding = "IMAGES_BUCKET"
  bucket_name = "<YOUR_R2_BUCKET_NAME>"
  ```

### Step 4: Authorized CMS Users (Firebase Authentication)
- Sign in to the CMS using **Sign In with Google** in the top navigation bar before clicking **Upload to R2**.
- By default, the project owner accounts (`scienceofgifts@gmail.com` and `dattarajpai.k@gmail.com`) are authorized.
- To authorize additional Google accounts or Firebase UIDs without code changes, set optional comma-separated Worker variables:
  ```bash
  CMS_AUTHORIZED_EMAILS="editor1@scienceofgifts.com,editor2@scienceofgifts.com"
  CMS_AUTHORIZED_UIDS="firebase-uid-1,firebase-uid-2"
  ```
