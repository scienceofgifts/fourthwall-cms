# Security Specification — Science of Gifts Fourthwall CMS

## 1. Data Invariants

1. **Tenant Isolation & Master Gate**: Every document under `/users/{userId}`, `/users/{userId}/products/{productId}`, `/users/{userId}/guides/{guideId}`, and `/users/{userId}/guides/{guideId}/sections/{sectionId}` is strictly owned by `userId`. Access requires `request.auth != null`, `request.auth.token.email_verified == true`, and `request.auth.uid == userId`.
2. **Relational Parent Integrity**: A `GuideSection` document at `/users/{userId}/guides/{guideId}/sections/{sectionId}` cannot be created, read, updated, or deleted unless the parent guide `/users/{userId}/guides/{guideId}` exists and `get(.../guides/$(guideId)).data.ownerId == request.auth.uid`.
3. **Immutable Ownership & Temporal Integrity**: `ownerId`, `guideId`, and `createdAt` are immutable across all updates. `createdAt` must equal `request.time` on creation, and `updatedAt` must equal `request.time` on both creation and update.
4. **Strict Key Allowlisting & Anti-Update-Gap**: Every `create` and `update` must pass `isValid[Entity](incoming())`, enforcing `hasAll` and `hasOnly` key sets, string length bounds, array size bounds, and ID regex patterns `^[a-zA-Z0-9_\-]+$`.

## 2. The "Dirty Dozen" Payloads

1. **Identity Spoofing on UserSettings**: Authenticated user `user_A` attempts to create `/users/user_A` with `ownerId: "user_B"`. -> `PERMISSION_DENIED`
2. **Unverified Email Write**: Authenticated user with `email_verified: false` attempts to create a product in `/users/user_A/products/prod_1`. -> `PERMISSION_DENIED`
3. **Cross-Tenant Read/List**: Authenticated user `user_B` attempts to `get` or `list` `/users/user_A/guides`. -> `PERMISSION_DENIED`
4. **Shadow Field Injection on Product Create**: User sends a valid product payload plus `"isAdmin": true`. -> `PERMISSION_DENIED`
5. **Shadow Field Injection on Guide Update**: User updates a guide with an undeclared key `"hacked": "yes"`. -> `PERMISSION_DENIED`
6. **ID Poisoning Attack**: User attempts to create `/users/user_A/products/invalid id with spaces!`. -> `PERMISSION_DENIED`
7. **Value Poisoning on Update (String Overflow)**: User updates `title` on a `GiftGuide` with a 5,000-character string (exceeding `maxLength: 300`). -> `PERMISSION_DENIED`
8. **Array Overflow on Product Tags**: User creates or updates a `Product` with 25 tags (exceeding `maxLength: 20`). -> `PERMISSION_DENIED`
9. **Immutable Field Mutation (`ownerId`)**: User attempts to change `ownerId` during a `Product` update. -> `PERMISSION_DENIED`
10. **Immutable Field Mutation (`createdAt`)**: User attempts to modify `createdAt` during a `GiftGuide` update. -> `PERMISSION_DENIED`
11. **Forged Client Timestamp**: User attempts to create a `GiftGuide` with a past/future `createdAt` not matching `request.time`. -> `PERMISSION_DENIED`
12. **Orphaned Subcollection Write**: User attempts to create `/users/user_A/guides/nonexistent_guide/sections/sec_1` where `nonexistent_guide` does not exist. -> `PERMISSION_DENIED`
