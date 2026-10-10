# vibld auth.md

How a person, or an agent acting for one, signs in to vibld. vibld does not
register agents: there is no agent registration endpoint, no client
credentials grant, and no API key. An agent works on behalf of a person
who has a vibld account and is signed in.

## Audience

- People using the builder at https://app.vibld.com.
- Scripts and agents calling the builder's API
  (https://app.vibld.com/api/) for such a person.

## Getting an account

A person signs up at https://app.vibld.com/sign-up. Sign-in is run by
Clerk, at
https://clerk.vibld.com. Nothing here creates an account without the
person.

## Credentials

- **Kind:** a Clerk session token, a JWT signed with RS256 and issued by
  `https://clerk.vibld.com`, for a session the person started at
  app.vibld.com. Keys: https://clerk.vibld.com/.well-known/jwks.json.
- **Lifetime:** short. Ask Clerk for a fresh token for each request or
  batch rather than storing one.
- **Use:** send it on every API request as
  `Authorization: Bearer <token>`. A missing token is answered `401`. A
  token that fails verification, expired ones included, is answered `403`
  with `"reason": "not-signed-in"`: get a fresh token from Clerk and retry.
- **Access:** routes that build, preview, publish or spend also need the
  account to be admitted to the beta. Without that they answer `403` with
  `"reason": "access-refused"`.

## Discovery

- The API's OpenAPI description, with every route and the security scheme
  it uses: https://app.vibld.com/api/openapi.json
- The API catalog (RFC 9727): https://vibld.com/.well-known/api-catalog
- Clerk's OpenID Connect metadata: https://clerk.vibld.com/.well-known/openid-configuration
- The guide for people: https://vibld.com/docs/api

## Revoking

Signing out at app.vibld.com ends the session, so no new tokens are issued
for it. Once an account's deletion is scheduled, the API refuses
its tokens with `403` and `"reason": "deletion-scheduled"`, apart from
the routes that show and cancel the deletion.
