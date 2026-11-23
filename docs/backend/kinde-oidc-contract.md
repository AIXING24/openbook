# Kinde OIDC contract for the GainTrace Pages backend

Research date: 2026-11-23. Scope: reuse the **existing Front-end and mobile public application**, with Authorization Code + PKCE, no client secret, and one fixed HTTPS backend callback. Only public Kinde documentation, pinned official SDK source, and the relevant protocol standards were consulted. No GainTrace tenant endpoint, discovery document, JWKS, user profile, token, private address, or credential was fetched. `https://gaintrace.kinde.com` is the issuer/domain supplied from the UI; its live metadata and application settings remain unverified.

## Conclusions and evidence limits

| Question | Finding | Evidence / qualification |
| --- | --- | --- |
| Can the existing public application authenticate without a client secret? | **Yes, documented:** Authorization Code + PKCE uses `code_verifier` instead of `client_secret`. | Kinde manual integration guide gives the complete public-client exchange; application docs explicitly say this type has no secret. [K1][K2] |
| Can the Worker perform that exchange? | **Supported at the protocol/SDK level.** A server-side HTTP exchange does not require converting this public application to a confidential application. | Official `AuthCodeWithPKCE` source explicitly says it is intended for both browser and server and sends no secret. Kinde supports manual integration in any framework and documents Workers verification. A deployment of this exact GainTrace combination has not been exercised here. [K1][K3][K10] |
| Must a second backend application be created? | No additional application is needed to validate tokens from a public app. For this proposed flow, reuse requires the backend callback to be registered on the existing app. | Kinde explicitly documents no second backend app for SPA bearer-token verification. Its separate server-session tutorial recommends a **Back-end web** app; that tutorial is not an explicit recipe for this public-app/Worker combination. Support for the proposed combination also rests on the PKCE SDK's server implementation. [K3][K4] |
| Is verified email guaranteed without requesting scopes? | **No unconditional default should be assumed.** Request `openid email`; `profile` adds names/avatar. | The current manual guide explicitly says `email` requests **both `email` and `email_verified` in the ID token**. SDK default scopes include these scopes, which is different from a provider-wide default. Neither scope guarantees the value is `true`. [K1][K5][K6] |
| Is UserInfo required to obtain verified email? | **Not according to the current manual guide**, when the requested ID-token email claims are supplied. UserInfo is an optional source for current profile information. | Both ID-token and UserInfo email claims require the granted `email` scope. The guide's sample tokens/profile omit `email_verified`, so examples alone do not prove actual tenant output. [K1] |
| Is the ID-token audience contract fully established? | **No: primary-source discrepancy remains.** Implement strict OIDC validation and resolve it before accepting real logins. | OIDC requires ID-token `aud` to contain the application's `client_id`; Kinde's ID-token page instead illustrates domain `aud` plus client-ID `azp`. An official browser SDK checks `iss`/`azp` and only checks `aud` when configured. These do not establish GainTrace's actual ID-token audience. [K5][K11][S1] |

The implementation can proceed using the documented no-secret PKCE contract. Acceptance of real identities still requires an independently authorized tenant flow demonstrating the actual `iss`, `aud`, `azp`, `nonce`, `email`, and boolean `email_verified` claims. This investigation does not establish that the existing application's callbacks, authentication methods, email sender, or token configuration have already been set correctly.

## Endpoint contract

Kinde publishes these paths in its manual guide. The GainTrace URLs below are **constructed from that documentation and the supplied issuer**, not observations from live tenant discovery. [K1][K7]

| Purpose | Expected URL |
| --- | --- |
| Issuer / configured auth domain | `https://gaintrace.kinde.com` |
| Discovery metadata | `https://gaintrace.kinde.com/.well-known/openid-configuration` |
| Authorization | `https://gaintrace.kinde.com/oauth2/auth` |
| Token exchange and refresh | `https://gaintrace.kinde.com/oauth2/token` |
| JWKS | `https://gaintrace.kinde.com/.well-known/jwks` |
| OIDC UserInfo | `https://gaintrace.kinde.com/oauth2/v2/user_profile` |
| Browser logout | `https://gaintrace.kinde.com/logout` |
| Revocation | `https://gaintrace.kinde.com/oauth2/revoke` |

Kinde documents **RS256**, RSA with a 2048-bit key and SHA-256. It explicitly does not support HMAC signing. Use a verification allowlist of `RS256`; do not infer support for `HS256`, `ES256`, `PS256`, `none`, or additional algorithms. The tenant's advertised `id_token_signing_alg_values_supported` and client authentication methods were not retrieved. [K7]

## Authorization and exact PKCE token request

Let `CLIENT_ID` be the existing public application's identifier, and `CALLBACK_URL` be one configured, literal HTTPS backend callback URL. This note intentionally does not supply a private test address or invent the deployed route.

At login start, the backend creates cryptographically random `state`, `nonce`, and `code_verifier`. For example, 32 random bytes each, base64url encoded without padding, produce 43-character values. RFC 7636 permits verifier lengths of 43–128 unreserved ASCII characters and recommends at least 256 bits of entropy. Derive:

```text
code_challenge = BASE64URL_WITHOUT_PADDING(SHA256(ASCII(code_verifier)))
```

Persist the transaction, bind it to the browser initiating login, and redirect that browser to the authorization endpoint with these URL-encoded query parameters. Kinde documents `state` as required with a minimum of eight characters; the stronger randomness above is the backend policy. [K1][S2]

```text
response_type=code
client_id=CLIENT_ID
redirect_uri=CALLBACK_URL
scope=openid profile email
state=STATE
nonce=NONCE
code_challenge=CHALLENGE
code_challenge_method=S256
```

`profile` is optional if GainTrace only needs the subject and email. Add Kinde's **`offline`** scope only when provider refresh tokens are needed. Kinde expressly says `offline_access` does not return a refresh token and produces no error. The scopes page's flow label `authorization_code_flow_pkce` is **not** the wire `grant_type`. [K1][K6]

On the fixed callback, reject OAuth errors and missing/duplicate `code` or `state`; match `state` to the browser-bound, unexpired, unused transaction before exchanging the code. Use the stored verifier and exact stored callback, not caller-supplied replacements.

The documented public-client request is: [K1][K3]

```http
POST /oauth2/token HTTP/1.1
Host: gaintrace.kinde.com
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=ENCODED_CODE&redirect_uri=ENCODED_CALLBACK_URL&client_id=ENCODED_CLIENT_ID&code_verifier=ENCODED_VERIFIER
```

Use `URLSearchParams` or equivalent form encoding for **every** value. Send no `client_secret`, including no empty secret, and no HTTP Basic client authentication. `code_challenge`, `code_challenge_method`, `state`, and `nonce` belong to the authorization transaction, not this token request. The SDK sends `application/x-www-form-urlencoded; charset=UTF-8` and uses exactly those five exchange fields. Its `Kinde-SDK` header is SDK metadata, not a required OAuth credential. [K3][K4]

The manual guide documents JSON `access_token` and `id_token`, plus `refresh_token` only if `offline` was requested. Check HTTP success and OAuth errors, bound response size/time, require the ID token needed for login, and verify it before creating a local session. Do not require a refresh token for a login that deliberately omitted `offline`. Avoid logging response bodies, authorization codes, tokens, or verifiers. These are backend safeguards rather than additional Kinde request parameters.

The Worker uses standard HTTPS `fetch` and Web Crypto; this exchange does not depend on browser CORS or on access to Kinde's browser cookies. Store a returned refresh token explicitly if refresh is used. Browser-only cookie refresh behavior is not a server refresh contract. The server/browser PKCE class and its form request are direct source evidence; deployment/runtime compatibility is still an implementation verification task. [K3][K4][K10]

## ID-token verification and email acceptance

Use an edge-compatible JWT library, such as `jose`, to perform signature **and claim** verification. Kinde's Worker tutorial establishes runtime feasibility, but its simplified example selects the first JWKS key and treats further claim checks as optional. That example is insufficient for this login contract. Select the matching signing key by `kid`, cache issuer JWKS with controlled rotation/refetch behavior, and fail closed when verification cannot complete. Pin the issuer/JWKS origin; never fetch token-supplied `jku`, `x5u`, or an arbitrary `iss`. [K7][K10]

| Check | Required GainTrace behavior | Basis |
| --- | --- | --- |
| Signature / algorithm | Verify the JWS using trusted issuer JWKS and allow only `RS256`. An `alg` header comparison or JWT decode alone is insufficient. | Kinde signing documentation; OIDC. [K7][S1] |
| `iss` | Require exact equality to the configured issuer `https://gaintrace.kinde.com`; do not normalize trailing slashes or accept another tenant/custom domain automatically. | Kinde issuer guidance and OIDC exact matching. [K7][S1] |
| `aud` | In strict OIDC mode, require a string equal to `CLIENT_ID`, or an array containing `CLIENT_ID` with no untrusted extra audiences. Reject an issuer-domain-only audience until a reviewed provider-specific contract is established. | OIDC Core §3.1.3.7; Kinde discrepancy below. [S1][K5] |
| `azp` | If present, require the existing application's `CLIENT_ID`; do not use it as a silent substitute for the required OIDC audience check. | OIDC guidance; Kinde token/SDK examples. [S1][K5][K11] |
| `exp`, `iat`, `nbf` | Require appropriate numeric time claims; reject expiry, implausibly future issue time, or an unmet `nbf` when present. Allow only a small configured clock tolerance. | Kinde time validation guidance and OIDC; tolerance is local policy. [K1][S1] |
| `nonce` | Require presence and exact match to the nonce stored for this one-use login transaction. Missing or mismatched nonce fails authentication. | Kinde recommends nonce; OIDC requires checking it when sent. [K1][S1] |
| `sub` | Require a nonempty subject; identify the account by the pair `(iss, sub)`. | Kinde subject definition and OIDC subject scope. [K5][S1] |
| `email` / `email_verified` | For verified-email acceptance, require a usable email and **`email_verified === true`**, the JSON boolean. Reject missing, false, null, or the string `"true"`. | Kinde's `email` scope requests the claims; OIDC defines verified email. Strict acceptance is GainTrace policy. [K1][S1] |

**Audience discrepancy:** Kinde's “ID tokens” page describes `aud` as potentially the Kinde domain/app URI and shows `aud: ["https://<your_subdomain>.kinde.com"]` with `azp` equal to a client ID. OIDC instead requires the client ID in ID-token `aud`. The pinned JavaScript SDK helper checks `iss` and `azp`; its `aud` check is conditional on configuration and it does not itself perform cryptographic verification. This is evidence of a provider/SDK convention, not evidence that GainTrace's real tokens follow it or justification to weaken the backend check. The request's optional `audience` parameter is documented for API/resource-server audiences; do not assume it fixes ID-token recipient validation. Resolve actual token behavior separately before enabling successful login. [K1][K5][K11][S1]

**Email claims versus defaults:** The strongest current provider statement is the manual guide's explicit wording: “Requests the `email` and `email_verified` claims in the `id_token`.” Its UserInfo FAQ also says both require the `email` scope. The dedicated ID-token page lists email but omits verified email; its examples omit it too. The TypeScript SDK's default scope is `openid profile email offline`, but a manual Worker must explicitly request its own scopes. Thus verified email is documented as requested via `email`, not as an unconditional token default or proof that every authenticated account has a verified address. `profile` does not establish email verification. [K1][K4][K5][K6]

If the verified ID token contains both acceptable email claims, no UserInfo call is required. If the implementation permits a **separately specified UserInfo fallback**, call the fixed `/oauth2/v2/user_profile` endpoint with the exchanged access token as `Authorization: Bearer ...`, require successful HTTPS JSON, require UserInfo `sub` to equal the verified ID-token `sub`, and require that response's email and boolean verification flag together. Do not combine one response's email with another response's verification flag. If the acceptance requirement is specifically **verified email in the ID token**, a fallback does not satisfy it: fail the login and resolve the missing claim. UserInfo is also appropriate for fresh profile data because ID-token claims are a login-time snapshot. [K1][S1 §5.3.2]

Map identity by issuer and subject. Do not automatically merge/link an existing GainTrace account solely because email strings match; any email-based linking needs an explicit conflict-safe policy. This is a backend safeguard, not an additional Kinde claim guarantee.

## Callback and application scoping

Allowed callback URLs and logout redirect URLs are configured on a **specific application** in a Kinde environment. Register the literal backend callback on the existing public application whose client ID the backend uses. Use the identical redirect URI in the authorization request and code exchange. A callback registered only on another application is not evidence this application accepts it. [K1][K8]

The same application can have multiple allowed callbacks. Reusing its client ID means its token recipient identity is the same across those callbacks; the callback hostname is not an independent ID-token audience. The backend must always initiate its own transaction using its fixed callback and accept only transactions it created. This scoping implication follows from client-ID audience validation and the per-app callback list. [K8][S1]

For production, use an exact HTTPS callback, with no wildcard, arbitrary `redirect_uri` input, or preview-host pattern. Kinde permits limited subdomain wildcards but recommends them only outside production; path wildcards and regex callbacks are unsupported. OAuth Security BCP requires exact redirect matching. Post-login navigation should use an allowlisted relative path stored with the transaction rather than changing the OAuth callback or accepting an open redirect. [K8][S3]

For this backend-session design, preserve the browser binding with a short-lived `Secure`, `HttpOnly`, `SameSite=Lax` transaction cookie and server-side transaction storage, or an equivalently protected design. The verifier must remain confidential; integrity-only signing does not make cookie contents confidential. Give transactions a short TTL (for example 5–10 minutes), consume them atomically, and keep state across Worker isolates rather than process memory. These values/storage choices are local safeguards. Use a fresh opaque session cookie after verification, with rotation, expiry, local revocation, and CSRF protection on state-changing routes. Kinde's server-session tutorial recommends frontend/API sharing the same domain and secure, same-site, HttpOnly cookies; a cross-site architecture needs an explicit cookie/CORS/CSRF design. [K4][S3]

## Lifetimes, refresh, and logout

Current Kinde defaults are **ID token: 1 hour (3,600 seconds); access token: 24 hours (86,400 seconds); refresh token: 15 days (1,296,000 seconds)**. They are configurable per application, and refresh lifetime must exceed access lifetime. Actual existing-app values were not inspected. Read and enforce token `exp`/response expiry rather than hardcoding defaults. An ID token's lifetime is unrelated to the lifetime of the local GainTrace session; Kinde's session policies explicitly do not govern sessions maintained by the app. [K5][K9][K12]

If `offline` was requested and a refresh token returned, the documented public-client refresh contract is: [K1][K3]

```http
POST /oauth2/token HTTP/1.1
Host: gaintrace.kinde.com
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&client_id=ENCODED_CLIENT_ID&refresh_token=ENCODED_REFRESH_TOKEN
```

No secret or new PKCE verifier is sent in that refresh request. Store refresh tokens only in protected backend storage and replace them atomically with each returned token. Kinde says refresh tokens always rotate; the same page says the old token becomes invalid and also describes a small overlap period for retries/parallel requests. It does not give a numeric overlap duration. Do not depend on a grace period: serialize refresh per session, coordinate concurrent requests, and handle `invalid_grant` without blindly clearing a session whose concurrent refresh may already have succeeded. [K3][K9a]

Initial-login nonce checks apply to the original authentication transaction. If refreshed ID tokens are used, follow OIDC refresh-response validation, including original issuer/subject/audience and original nonce if returned; do not invent a new authentication nonce during refresh or require a refresh response to reproduce every login-time claim. [S1 §12.2]

Logout has distinct effects:

1. **GainTrace logout:** revoke/delete the local backend session and clear its cookie and retained provider credentials. This provides immediate denial for backend routes checking the local session.
2. **Kinde browser logout:** redirect the browser to `https://gaintrace.kinde.com/logout?redirect=ENCODED_ALLOWED_LOGOUT_URL`. Kinde documents this as ending its session and requires a registered logout redirect. Its callback guide explicitly says silent logout without a redirect is unsupported. A Worker `fetch` alone does not perform browser logout. [K1][K4][K8]
3. **Already issued JWTs:** local signature verification continues to accept an unexpired access token unless the resource server has its own denial mechanism. Kinde expressly documents that revocation/session termination does not invalidate already held access tokens for local validation. With the default access lifetime, the remaining window can approach 24 hours. Shorter configured access lifetimes and backend session checks reduce it. [K9]

Do not promise that ordinary logout revokes every token or signs the user out of an upstream social provider. The examined sources do not establish those effects. Kinde's revocation documentation shows `/oauth2/revoke` with `token`, `client_id`, and **`client_secret`**; a secretless public-app revocation contract is not established by that example. “Sign out everywhere” via Management API additionally requires an M2M app and scope. Neither capability is a dependency of this constrained public-app login design, and no new account/resource should be created for it. [K9][K12]

## Narrow production email note

Kinde's official sender guide says emails default to `no-reply@kinde.com` without a custom sender, and under requirements says **“You need to set up provider details before making your environment live.”** Treat that as a documented go-live requirement for email-based auth, not proof of the tenant's current sender configuration, paid-plan requirement, hard quota, or delivery failure. Sender/plan verification remains with the main agent. [K13]

## Primary sources

All sources below were read on 2026-11-23. Documentation pages are mutable; SDK links are pinned to the retrieved commit.

- **[K1]** Kinde, [Use Kinde without an SDK](https://docs.kinde.com/developer-tools/about/using-kinde-without-an-sdk/): endpoints, public-client PKCE request, state/nonce, ID-token email scopes, UserInfo FAQ, public refresh, logout.
- **[K2]** Kinde, [Applications in Kinde](https://docs.kinde.com/build/applications/about-applications/): public versus confidential applications, secret availability, supported flows.
- **[K3]** Official TypeScript SDK, [`AuthCodeWithPKCE.ts`](https://github.com/kinde-oss/kinde-typescript-sdk/blob/6be5ea4c9e1e63b7197ab2856f124763b30c338c/lib/sdk/oauth2-flows/AuthCodeWithPKCE.ts): explicit browser/server intent, S256, exact exchange body, no-secret refresh.
- **[K4]** Official TypeScript SDK, [`AuthCodeAbstract.ts`](https://github.com/kinde-oss/kinde-typescript-sdk/blob/6be5ea4c9e1e63b7197ab2856f124763b30c338c/lib/sdk/oauth2-flows/AuthCodeAbstract.ts): endpoint paths, default scopes, form POST; Kinde, [Authenticating SPAs](https://docs.kinde.com/build/applications/authenticating-spa/): public app/API verification and separate backend-session tutorial; SDK [`authcode-with-pkce.ts`](https://github.com/kinde-oss/kinde-typescript-sdk/blob/6be5ea4c9e1e63b7197ab2856f124763b30c338c/lib/sdk/clients/browser/authcode-with-pkce.ts): logout clears local session and returns provider URL.
- **[K5]** Kinde, [ID tokens](https://docs.kinde.com/build/tokens/about-id-tokens/): claim descriptions/sample, missing-scope guidance, default ID lifetime. The `aud` example and omitted `email_verified` require the qualifications above.
- **[K6]** Kinde, [Using OAuth scopes](https://docs.kinde.com/build/tokens/oath-scopes/): scopes, PKCE and Kinde-specific `offline`.
- **[K7]** Kinde, [Verifying JSON Web Tokens](https://docs.kinde.com/build/tokens/verifying-json-web-tokens/): RS256/RSA, no HMAC, JWKS path, issuer checks.
- **[K8]** Kinde, [Set callback and redirect URLs](https://docs.kinde.com/get-started/connect/callback-urls/): application-specific settings, matching, wildcard limits, browser logout requirement.
- **[K9]** Kinde, [Configure token and session expiry](https://docs.kinde.com/build/tokens/configure-tokens/): default lifetimes, per-app configuration, revocation request, remaining JWT validity.
- **[K9a]** Kinde, [Refresh tokens](https://docs.kinde.com/build/tokens/refresh-tokens/): offline scope, rotation/overlap, storage, expiry, public-client caution.
- **[K10]** Kinde, [Kinde and edge worker services](https://docs.kinde.com/integrate/third-party-tools/kinde-edge-workers/) and [Verifying JWTs in Cloudflare Workers](https://docs.kinde.com/integrate/third-party-tools/verifying-jwts-cloudflare-workers/): Worker support and runtime-compatible verification; illustrative code needs the safeguards above.
- **[K11]** Official JavaScript SDK, [`isTokenValid.ts`](https://github.com/kinde-oss/kinde-auth-pkce-js/blob/d1b9c4bb29618b7e26db9eca8545ecfde1d64e6e/src/utils/isTokenValid/isTokenValid.ts): decoded `iss`/`azp` checks, RS256 header, conditional `aud` check. This helper is not a server signature verifier.
- **[K12]** Kinde, [Session management](https://docs.kinde.com/authenticate/manage-authentication/session-management/): Kinde versus local sessions, SSO default timeout, M2M-backed session termination.
- **[K13]** Kinde, [Customize email sender](https://docs.kinde.com/get-started/connect/customize-email-sender/): default sender and before-live provider requirement.
- **[S1]** OpenID Foundation, [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html): [ID-token validation §3.1.3.7](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation), [standard claims §5.1](https://openid.net/specs/openid-connect-core-1_0.html#StandardClaims), [UserInfo §5.3.2](https://openid.net/specs/openid-connect-core-1_0.html#UserInfoResponse), [refresh validation §12.2](https://openid.net/specs/openid-connect-core-1_0.html#RefreshTokenResponse).
- **[S2]** IETF, [RFC 7636](https://www.rfc-editor.org/rfc/rfc7636.html), §§4.1–4.6, 7.1: verifier syntax/entropy, S256 derivation, verifier at token exchange.
- **[S3]** IETF, [RFC 9700 OAuth 2.0 Security BCP](https://www.rfc-editor.org/rfc/rfc9700.html), §§2.1, 4.7, 4.11, 4.14: exact redirect matching, browser-bound CSRF protection, no open redirects, refresh protection.
