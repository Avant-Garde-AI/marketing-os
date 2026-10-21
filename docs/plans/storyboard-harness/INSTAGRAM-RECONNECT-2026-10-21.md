# Instagram Login reconnect verifier correction — 2026-10-21

A newly generated token for the existing @arthaushq destination succeeded on
`GET /me?fields=user_id,username`, matching the bound account. The reconnect
verifier then rejected it because `GET /me/permissions` returned HTTP 400,
IGApiException code 100: the permissions field does not exist on this API.
No replacement credential had been stored. The earlier generic error incorrectly
instructed the owner to generate another token.

The verifier now checks identity first, then reads the exact verified account's
`content_publishing_limit?fields=quota_usage,config`. Meta documents both
`instagram_business_basic` and `instagram_business_content_publish` as required
for this read. The live replacement token returned HTTP 200, quota usage zero,
quota total 100 and duration 86400. These are observations, not hard-coded limits.
The check creates no media and does not publish or grant post consent.

[Meta endpoint reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit)

Malformed or denied capability responses fail closed. An exhausted quota does
not invalidate an otherwise valid connection. Errors expose only a fixed stage
and a numeric Meta code, never raw provider text or credentials. The token stays
in an Authorization header and is persisted only through the existing owner-
authenticated credential broker after all checks pass.

The original Meta app is Marketing OS (4014012292232052), Instagram app
Marketing OS-IG (1348352763408841). Easel is a separate app; its new review draft
was not submitted. Production deployment and an owner retry are still required
before claiming that the connection has recovered.
