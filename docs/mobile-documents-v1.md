# Mobile documents API v1

These read-only routes extend `/api/mobile/v1`. Every route requires `Authorization: Bearer <accessToken>`, returns private responses with `Cache-Control: no-store`, and uses the standard mobile error envelope. They expose tailored resume and cover letter content for applications available to the mobile API; applications awaiting review and missing applications both return `404 not_found`.

## `GET /applications/{id}/documents`

Returns the current resume and cover letter, with `null` for a document the application does not have:

```json
{
  "applicationId": "cm...",
  "documents": {
    "resume": {
      "id": "document-id",
      "kind": "resume",
      "label": "Resume",
      "updatedAt": "2026-11-18T12:00:00.000Z",
      "currentVersionId": "version-id",
      "pdfUrl": "/api/mobile/v1/applications/cm.../documents/resume/pdf",
      "units": [{ "id": "summary", "label": "Summary", "text": "..." }]
    },
    "coverLetter": null
  }
}
```

`units` use the shared tailored document unit shape `{ id, label, text, unverified? }` and are in reading order. `coverLetter` uses `kind: "cover-letter"`, `label: "Cover letter"`, and its own `pdfUrl`. `currentVersionId` is nullable: it is set only if the newest saved history snapshot has the same units as the live document. The document `id` identifies the editable document row; it is not a historical version ID.

## `GET /applications/{id}/documents/{kind}`

Reads one document and returns `{ "document": <document DTO> }`. `{kind}` is `resume` or `cover-letter`. A supported but absent document returns `404 not_found` with a document-specific message. An unsupported kind returns `400 invalid_request`.

## `GET /applications/{id}/documents/{kind}/pdf`

Returns the document as `application/pdf`, with the same print page, renderer, and Settings → PDF filename pattern used by the web download. The `Content-Disposition` header is an attachment filename. This route returns PDF bytes rather than JSON on success; failures use the standard mobile error envelope.

The routes only read application document data. They do not edit, generate, restore, email, or send documents and never return provider settings or credentials.
