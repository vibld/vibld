/**
 * The builder API's OpenAPI 3.1 description (D186), served at
 * `/api/openapi.json` (api-description.ts) and listed in vibld.com's API
 * catalog. Written from the handlers, not generated from them:
 * `test/openapi.test.ts` fails on a route the router dispatches that this
 * neither describes nor lists in `UNDESCRIBED`, and on a path here the
 * router does not have.
 */

/** Routes the router has that are not part of the public description. */
export const UNDESCRIBED: Readonly<Record<string, string>> = {
  '/api/github/callback': 'a redirect target GitHub sends a browser to',
  '/api/github/webhook': "GitHub's own delivery, signed by GitHub",
  '/api/stripe/webhook': "Stripe's own delivery, signed by Stripe",
};

export const OPENAPI = {
  openapi: '3.1.0',
  info: {
    title: 'vibld builder API',
    version: '0.1.0',
    summary: 'The HTTP API the vibld builder at app.vibld.com runs on.',
    description:
      'Every route the builder itself calls, except administration, payment and GitHub webhooks, and the GitHub sign-in callback. A request signs in with the scheme `security` names: on app.vibld.com, the session token Clerk issues to a person signed in there, sent as `Authorization: Bearer`. Routes that build, preview, publish or spend also need an invitation to the beta: without one they answer 403 with `reason: "access-refused"`.',
    contact: {
      name: 'vibld',
      url: 'https://vibld.com',
    },
  },
  externalDocs: {
    description: 'The builder API, for people',
    url: 'https://vibld.com/docs/api',
  },
  servers: [
    {
      url: 'https://app.vibld.com',
      description: 'The hosted builder',
    },
  ],
  security: [
    {
      clerk: [],
    },
  ],
  tags: [
    {
      name: 'Building',
      description: 'Conversations, plans, builds and live previews.',
    },
    {
      name: 'Projects',
      description: "The caller's projects and their history.",
    },
    {
      name: 'Sharing',
      description: 'Share links, from both sides.',
    },
    {
      name: 'Publishing',
      description: 'Sites on the web and preview links.',
    },
    {
      name: 'Media',
      description: "The caller's media library and the design catalog.",
    },
    {
      name: 'Account',
      description: 'Configuration, access, referrals and account deletion.',
    },
    {
      name: 'Billing',
      description: 'Balance, plans, top-ups and saved cards.',
    },
    {
      name: 'GitHub',
      description:
        'Connecting a project to a GitHub repository and pushing to it.',
    },
    {
      name: 'Meta',
      description: 'This description and a liveness check.',
    },
  ],
  paths: {
    '/api/access/status': {
      get: {
        operationId: 'getAccessStatus',
        summary:
          'Report whether the signed-in caller is admitted by the invite gate.',
        description:
          'Not behind the invite gate: this is the endpoint that reports the refusal. It says whether the caller is in, never why not. An admitted caller is recorded in the account list as a side effect. Any method other than GET is answered 405 after the principal is resolved.',
        tags: ['Account'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        responses: {
          '200': {
            description: 'The access decision.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AccessStatus',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names (reason `not-signed-in`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '403': {
            description:
              'Refused before the handler runs: sign-in is not configured for this deployment (`not-configured`), the token failed verification (`not-signed-in`), the account is banned (`account-banned`) or scheduled for deletion (`deletion-scheduled`, with `purgeAfter`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '405': {
            description:
              'Method other than GET (checked after the principal is resolved).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'The account could not be checked for a ban or a pending deletion (the database did not answer).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/account/delete': {
      get: {
        operationId: 'getAccountDeletion',
        summary:
          "Report whether the caller's account is scheduled for deletion and how far the request has got.",
        description:
          'Not invite-gated. Answered for an account already scheduled for deletion. The method is checked before identity.',
        tags: ['Account'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        responses: {
          '200': {
            description: "The deletion request's state.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AccountDeletionStatus',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names. The body also carries `reason: "not-signed-in"`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '403': {
            description:
              'The session token failed verification, the account is banned, or sign-in is not configured on this deployment.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '405': {
            description:
              'Method not allowed. The error text names the accepted methods (GET, POST).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Account deletion is not configured, or the account could not be checked right now.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'requestAccountDeletion',
        summary:
          "Ask for the caller's account to be deleted, or retry the immediate steps of a request that already stands.",
        description:
          'Not invite-gated. Asking again never moves the purge date. The Content-Type is not checked.',
        tags: ['Account'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        requestBody: {
          required: false,
          description:
            'Required, with the confirmation phrase, when no request stands; not read when one does.',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/AccountDeletionRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description:
              "The deletion request's state, with the immediate steps done so far and any errors.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AccountDeletionStatus',
                },
              },
            },
          },
          '400': {
            description:
              'The body is not valid JSON, or the confirmation phrase is missing or wrong.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names. The body also carries `reason: "not-signed-in"`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '403': {
            description:
              'The session token failed verification, the account is banned, or sign-in is not configured on this deployment.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '405': {
            description:
              'Method not allowed. The error text names the accepted methods (GET, POST).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Account deletion is not configured, the account could not be checked, or the request could not be recorded (nothing was deleted).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/account/delete/cancel': {
      post: {
        operationId: 'cancelAccountDeletion',
        summary:
          "Withdraw the caller's account deletion request while its purge has not started.",
        description:
          'Not invite-gated. No body is read and the Content-Type is not checked.',
        tags: ['Account'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        responses: {
          '200': {
            description: 'Canceled, or there was nothing to cancel.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AccountDeletionCancelResult',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names. The body also carries `reason: "not-signed-in"`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '403': {
            description:
              'The session token failed verification, the account is banned, or sign-in is not configured on this deployment.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '405': {
            description:
              'Method not allowed. The error text names the accepted methods (POST).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '409': {
            description:
              'The deletion has already started and can no longer be canceled.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Account deletion is not configured, or the account could not be checked right now.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/billing/auto-reload': {
      post: {
        operationId: 'setBillingAutoReload',
        summary:
          'Turn auto-reload (an off-session $10 top-up charge on a saved card) on or off.',
        description:
          'Turning it off is open to any signed-in caller. Turning it on is behind the invite gate inside the handler, and when the account is already below the threshold the first reload is attempted at once and reported in `reload`.',
        tags: ['Billing'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/AutoReloadRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description:
              'The saved settings. `card` and `reload` are present only when turning it on.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AutoReloadSettingsResponse',
                },
              },
            },
          },
          '400': {
            description:
              '`enabled` is missing or not a boolean (an unparseable body is treated the same way), or `monthlyCapUsdCents` is not a whole number of $10 top-ups from 1000 to 10000.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '401': {
            description: 'No sign-in was sent (`reason: "not-signed-in"`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthRefusal',
                },
              },
            },
          },
          '403': {
            description:
              'Principal refusal as on every authenticated route (`reason` is `not-signed-in`, `account-banned`, `deletion-scheduled` or `not-configured`); turning it on while not admitted by the invite gate (`accessRefused: true`, `reason: "access-refused"`); or turning it on while the account is suspended after a lost dispute.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthRefusal',
                },
              },
            },
          },
          '405': {
            description:
              'Any method other than POST (`{"error": "Use POST."}`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '409': {
            description:
              'Turning it on with no saved card Stripe can charge off-session (`needsCard: true`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/BillingConflict',
                },
              },
            },
          },
          '502': {
            description: 'The saved card could not be read from Stripe.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Billing is not configured for this deployment (Stripe secret, webhook secret or D1 missing). Checked before the principal is resolved. Also returned when the account check against D1 fails.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/billing/auto-subscribe': {
      post: {
        operationId: 'setBillingAutoSubscribe',
        summary:
          'Turn auto-subscribe (start the Build plan on a saved card when Free runs out) on or off.',
        description:
          'Turning it off is open to any signed-in caller. Turning it on is behind the invite gate inside the handler, is offered on Free only, works once per account, and starts the plan at once when the account is already out.',
        tags: ['Billing'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/AutoSubscribeRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description:
              'The saved setting. `card` and `disabledReason` are present only when turning it on.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AutoSubscribeSettingsResponse',
                },
              },
            },
          },
          '400': {
            description:
              '`enabled` is missing or not a boolean (an unparseable body is treated the same way).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '401': {
            description: 'No sign-in was sent (`reason: "not-signed-in"`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthRefusal',
                },
              },
            },
          },
          '403': {
            description:
              'Principal refusal as on every authenticated route; turning it on while not admitted by the invite gate (`accessRefused: true`, `reason: "access-refused"`); or turning it on while the account is suspended after a lost dispute.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthRefusal',
                },
              },
            },
          },
          '405': {
            description:
              'Any method other than POST (`{"error": "Use POST."}`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '409': {
            description:
              'Turning it on when the account is already on a plan (`alreadySubscribed: true`), when auto-subscribe has already started a plan once (`alreadyUsed: true`), or when there is no saved card Stripe can charge off-session (`needsCard: true`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/BillingConflict',
                },
              },
            },
          },
          '502': {
            description: 'The saved card could not be read from Stripe.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Billing is not configured for this deployment (Stripe secret, webhook secret or D1 missing). Checked before the principal is resolved. Also returned when the account check against D1 fails.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/billing/cancel': {
      post: {
        operationId: 'createBillingCancelSession',
        summary:
          "Open a Stripe-hosted page that cancels the caller's subscription and return its URL.",
        description:
          'Not behind the invite gate. No request body is read. A monthly plan may be offered a retention coupon on that page; a subscription already ending is sent to the plain portal instead.',
        tags: ['Billing'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        responses: {
          '200': {
            description:
              'The Stripe-hosted cancellation URL to navigate the browser to.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RedirectUrl',
                },
              },
            },
          },
          '401': {
            description: 'No sign-in was sent (`reason: "not-signed-in"`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthRefusal',
                },
              },
            },
          },
          '403': {
            description:
              'The token failed verification (`reason: "not-signed-in"`), the account is banned (`reason: "account-banned"`), or it is scheduled for deletion (`reason: "deletion-scheduled"`, with `purgeAfter`). A deployment with no sign-in configured answers 403 with `reason: "not-configured"`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthRefusal',
                },
              },
            },
          },
          '405': {
            description:
              'Any method other than POST (`{"error": "Use POST."}`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '502': {
            description:
              'The cancellation session could not be created, including when the account has no subscription to cancel.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Billing is not configured for this deployment (Stripe secret, webhook secret or D1 missing). Checked before the principal is resolved. Also returned when the account check against D1 fails.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/billing/card': {
      post: {
        operationId: 'createBillingCardSetup',
        summary:
          'Open a Stripe-hosted page that saves a card without charging it and return its URL.',
        description:
          'Behind the invite gate. The body is optional; an unparseable or absent body is treated as no purpose. Stripe returns the browser to `/billing/card-added` or `/billing/cancelled` on this origin.',
        tags: ['Billing'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/CardSetupRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description:
              'The Stripe card-setup URL to navigate the browser to.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RedirectUrl',
                },
              },
            },
          },
          '401': {
            description: 'No sign-in was sent (`reason: "not-signed-in"`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthRefusal',
                },
              },
            },
          },
          '403': {
            description:
              'The token failed verification (`reason: "not-signed-in"`), the account is banned (`reason: "account-banned"`), or it is scheduled for deletion (`reason: "deletion-scheduled"`, with `purgeAfter`). Also returned, with `accessRefused: true` and `reason: "access-refused"`, when the caller is signed in but not admitted by the invite gate; the gate runs before the handler, so this applies to every method. A deployment with no sign-in configured answers 403 with `reason: "not-configured"`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthRefusal',
                },
              },
            },
          },
          '405': {
            description:
              'Any method other than POST (`{"error": "Use POST."}`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '409': {
            description:
              'Unless `purpose` is `auto-reload`: the account already has a card on file and is not waiting on a card for the welcome credit.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '502': {
            description: 'Stripe could not create the card-setup session.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Billing is not configured for this deployment (Stripe secret, webhook secret or D1 missing). Checked before the principal is resolved. Also returned when the account check against D1 fails.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/billing/checkout': {
      post: {
        operationId: 'createBillingCheckout',
        summary:
          'Start a Stripe Checkout session for a plan subscription or a top-up and return its URL.',
        description:
          'Behind the invite gate. Send either `{ "topup": true }` or `{ "tier", "interval" }`; when `topup` is `true` the other fields are ignored. Stripe returns the browser to `/billing/success?session_id=...` or `/billing/cancelled` on this origin.',
        tags: ['Billing'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/CheckoutRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'The Stripe Checkout URL to navigate the browser to.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RedirectUrl',
                },
              },
            },
          },
          '400': {
            description:
              'The body is not valid JSON, is not an object, or names no valid purchase (`tier` must be `build` or `ship`, `interval` must be `monthly` or `annual`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '401': {
            description: 'No sign-in was sent (`reason: "not-signed-in"`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthRefusal',
                },
              },
            },
          },
          '403': {
            description:
              'The token failed verification (`reason: "not-signed-in"`), the account is banned (`reason: "account-banned"`), or it is scheduled for deletion (`reason: "deletion-scheduled"`, with `purgeAfter`). Also returned, with `accessRefused: true` and `reason: "access-refused"`, when the caller is signed in but not admitted by the invite gate; the gate runs before the handler, so this applies to every method. A deployment with no sign-in configured answers 403 with `reason: "not-configured"`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthRefusal',
                },
              },
            },
          },
          '405': {
            description:
              'Any method other than POST (`{"error": "Use POST."}`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '409': {
            description:
              'Auto-subscribe is already starting the Build plan for this account (`autoSubscribing: true`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/BillingConflict',
                },
              },
            },
          },
          '502': {
            description: 'Stripe could not create the Checkout session.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Billing is not configured for this deployment (Stripe secret, webhook secret or D1 missing). Checked before the principal is resolved. Also returned when the account check against D1 fails.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/billing/portal': {
      post: {
        operationId: 'createBillingPortalSession',
        summary:
          'Open a Stripe Billing Portal session for the caller and return its URL.',
        description:
          'Not behind the invite gate. No request body is read. The portal returns to `/` on this origin.',
        tags: ['Billing'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        responses: {
          '200': {
            description: 'The Billing Portal URL to navigate the browser to.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RedirectUrl',
                },
              },
            },
          },
          '401': {
            description: 'No sign-in was sent (`reason: "not-signed-in"`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthRefusal',
                },
              },
            },
          },
          '403': {
            description:
              'The token failed verification (`reason: "not-signed-in"`), the account is banned (`reason: "account-banned"`), or it is scheduled for deletion (`reason: "deletion-scheduled"`, with `purgeAfter`). A deployment with no sign-in configured answers 403 with `reason: "not-configured"`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthRefusal',
                },
              },
            },
          },
          '405': {
            description:
              'Any method other than POST (`{"error": "Use POST."}`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '502': {
            description:
              'The portal session could not be created, including when the account has no Stripe customer yet.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Billing is not configured for this deployment (Stripe secret, webhook secret or D1 missing). Checked before the principal is resolved. Also returned when the account check against D1 fails.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/billing/status': {
      get: {
        operationId: 'getBillingStatus',
        summary:
          "Read the caller's plan, allowance, spend, credit and auto-reload/auto-subscribe settings.",
        description:
          'Not behind the invite gate. Not strictly read-only: it may open the welcome-credit offer (only for an admitted caller), and when auto-reload or auto-subscribe is on (or an auto-subscribe attempt is in flight) and the caller is admitted, it runs the auto-reload check, which can charge a saved card.',
        tags: ['Billing'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        responses: {
          '200': {
            description: "The caller's billing status.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/BillingStatus',
                },
              },
            },
          },
          '401': {
            description: 'No sign-in was sent (`reason: "not-signed-in"`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthRefusal',
                },
              },
            },
          },
          '403': {
            description:
              'The token failed verification (`reason: "not-signed-in"`), the account is banned (`reason: "account-banned"`), or it is scheduled for deletion (`reason: "deletion-scheduled"`, with `purgeAfter`). A deployment with no sign-in configured answers 403 with `reason: "not-configured"`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthRefusal',
                },
              },
            },
          },
          '405': {
            description: 'Any method other than GET (`{"error": "Use GET."}`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Usage accounting is not configured (no USER_BUDGET or DB binding), the billing status could not be read, or the account check against D1 failed.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/chat': {
      post: {
        operationId: 'sendChatTurn',
        summary:
          'Send one turn of the builder conversation and get a reply or a build brief.',
        description:
          'Behind the invite gate for every method. Spends model budget on every turn. A turn either replies in words (`action: "reply"`) or hands back a brief the client then builds through `POST /api/plan` (`action: "build"`). Only the most recent 24 messages are kept; older ones are dropped rather than refused.',
        tags: ['Building'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ChatRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description: "The assistant's turn and the model that produced it.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ChatResponse',
                },
              },
            },
          },
          '400': {
            description:
              'Body is not valid JSON or fails validation, or an unknown `model` (reason `request-invalid`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names (reason `not-signed-in`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '403': {
            description:
              'Cross-site Origin (`request-invalid`), model not allowed (`model-not-allowed`), account suspended (`account-suspended`), or an identity refusal. Also the invite gate: a signed-in caller who has not been invited gets `accessRefused: true` and reason `access-refused`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '405': {
            description:
              'Method other than POST (answered after the invite gate).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '413': {
            description:
              'Declared body over 256 KiB, or a message, the conversation, the summary or the path list over its limit (reason `request-invalid`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '415': {
            description:
              'Content-Type is not application/json (reason `request-invalid`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '429': {
            description:
              'Rate limited (`rate-limited`), not enough budget (`account-ceiling`), or a generation already running (`already-running`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '502': {
            description:
              'The model call failed. `stop` is present when the provider classified the failure.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ChatProviderFailure',
                },
              },
            },
          },
          '503': {
            description:
              'Generation is not configured (`not-configured`), usage accounting is unavailable (`accounting-unavailable`, `retry-after: 30`), or the chosen model cannot be served (`model-not-allowed`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
        },
      },
    },
    '/api/config': {
      get: {
        operationId: 'getBuilderConfig',
        summary:
          'Describe what this deployment can do for the caller: model picker, default model, admin flag and preview mode.',
        description:
          'Not behind the invite gate. The handler has no method check: any method is answered the same way as GET. A deployment that cannot generate is reported (`generation: "fake"`, empty `models`) rather than refused.',
        tags: ['Account'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        responses: {
          '200': {
            description: "The caller's builder configuration.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/BuilderConfig',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names (reason `not-signed-in`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '403': {
            description:
              'Refused before the handler runs: sign-in is not configured for this deployment (`not-configured`), the token failed verification (`not-signed-in`), the account is banned (`account-banned`) or scheduled for deletion (`deletion-scheduled`, with `purgeAfter`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '503': {
            description:
              'The account could not be checked for a ban or a pending deletion (the database did not answer).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/github/bind': {
      post: {
        operationId: 'bindGitHubRepository',
        summary: 'Bind one of the offered repositories to a project.',
        description:
          'Behind the invite gate. The repository is matched (case-insensitively) against the list signed into `ticket`; the binding is written from that entry and lasts 90 days.',
        tags: ['GitHub'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/GitHubBindRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'The binding that was written.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/GitHubBinding',
                },
              },
            },
          },
          '400': {
            description:
              'The body is not valid JSON; `projectId` is missing or not a project id (the page is out of date); `ticket`, `owner` or `repo` is not a string; or the ticket has expired or names another caller.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '401': {
            description: 'No sign-in was sent (`reason: "not-signed-in"`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthRefusal',
                },
              },
            },
          },
          '403': {
            description:
              'The token failed verification (`reason: "not-signed-in"`), the account is banned (`reason: "account-banned"`), or it is scheduled for deletion (`reason: "deletion-scheduled"`, with `purgeAfter`). Also returned, with `accessRefused: true` and `reason: "access-refused"`, when the caller is signed in but not admitted by the invite gate; the gate runs before the handler, so this applies to every method. A deployment with no sign-in configured answers 403 with `reason: "not-configured"`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthRefusal',
                },
              },
            },
          },
          '404': {
            description: "The project does not exist or is not the caller's.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '405': {
            description:
              'Any method other than POST (`{"error": "Use POST."}`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Connecting a GitHub repository is not configured, or the account check against D1 failed.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/github/complete': {
      post: {
        operationId: 'completeGitHubConnect',
        summary:
          'Exchange the GitHub callback code, record the account connection and list the repositories the caller may bind.',
        description:
          "Behind the invite gate. `state` must verify and name the caller. Optionally creates a new repository on the caller's own account first (`create`); a failure there is reported in `createProblem` and does not fail the request.",
        tags: ['GitHub'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/GitHubCompleteRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description:
              'The connectable repositories and a signed `ticket` to pass to `/api/github/bind`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/GitHubCompleteResponse',
                },
              },
            },
          },
          '400': {
            description:
              'The body is not valid JSON; `code` or `state` is missing or empty; the state has expired or names another caller; or GitHub reported the request as invalid.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/GitHubProblem',
                },
              },
            },
          },
          '401': {
            description: 'No sign-in was sent (`reason: "not-signed-in"`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthRefusal',
                },
              },
            },
          },
          '403': {
            description:
              'The token failed verification (`reason: "not-signed-in"`), the account is banned (`reason: "account-banned"`), or it is scheduled for deletion (`reason: "deletion-scheduled"`, with `purgeAfter`). Also returned, with `accessRefused: true` and `reason: "access-refused"`, when the caller is signed in but not admitted by the invite gate; the gate runs before the handler, so this applies to every method. A deployment with no sign-in configured answers 403 with `reason: "not-configured"`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthRefusal',
                },
              },
            },
          },
          '405': {
            description:
              'Any method other than POST (`{"error": "Use POST."}`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '409': {
            description:
              'The vibld GitHub App is not installed on any account the caller can reach (`install: true`), or GitHub refused access or found nothing (`reconnect: true` only when the grant is gone).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/GitHubProblem',
                },
              },
            },
          },
          '429': {
            description: 'GitHub rate-limited the request.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/GitHubProblem',
                },
              },
            },
          },
          '502': {
            description:
              'GitHub was unreachable, refused, or answered unreadably.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/GitHubProblem',
                },
              },
            },
          },
          '503': {
            description:
              'Connecting a GitHub repository is not configured, GitHub configuration failed, or the account check against D1 failed.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/github/connect': {
      get: {
        operationId: 'startGitHubConnect',
        summary:
          'Begin the GitHub sign-in by returning the authorization URL and a signed state.',
        description:
          'Behind the invite gate. Answers with JSON rather than a redirect, so the builder navigates to `url` itself and keeps `state` to compare on the way back.',
        tags: ['GitHub'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        responses: {
          '200': {
            description: 'Where to send the browser.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/GitHubConnectStart',
                },
              },
            },
          },
          '401': {
            description: 'No sign-in was sent (`reason: "not-signed-in"`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthRefusal',
                },
              },
            },
          },
          '403': {
            description:
              'The token failed verification (`reason: "not-signed-in"`), the account is banned (`reason: "account-banned"`), or it is scheduled for deletion (`reason: "deletion-scheduled"`, with `purgeAfter`). Also returned, with `accessRefused: true` and `reason: "access-refused"`, when the caller is signed in but not admitted by the invite gate; the gate runs before the handler, so this applies to every method. A deployment with no sign-in configured answers 403 with `reason: "not-configured"`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthRefusal',
                },
              },
            },
          },
          '405': {
            description: 'Any method other than GET (`{"error": "Use GET."}`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Connecting a GitHub repository is not configured (OAuth credentials or D1 missing), or the account check against D1 failed.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/github/diff': {
      post: {
        operationId: 'previewGitHubPush',
        summary:
          "Preview what pushing the given files would change in the project's connected repository.",
        description:
          'Behind the invite gate. Read-only: writes nothing to GitHub or D1. Shares the per-caller GitHub rate limiter with `/api/github/push`. Referenced uploaded media are included in the comparison.',
        tags: ['GitHub'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/GitHubDiffRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description:
              'The destination and the paths the push would add, change and remove.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/GitHubDiffResponse',
                },
              },
            },
          },
          '400': {
            description:
              'The body is not valid JSON or not an object; `projectId` is missing or not a project id (the page is out of date); `files` is empty or malformed; or GitHub reported the request as invalid.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/GitHubProblem',
                },
              },
            },
          },
          '401': {
            description: 'No sign-in was sent (`reason: "not-signed-in"`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthRefusal',
                },
              },
            },
          },
          '403': {
            description:
              'The token failed verification (`reason: "not-signed-in"`), the account is banned (`reason: "account-banned"`), or it is scheduled for deletion (`reason: "deletion-scheduled"`, with `purgeAfter`). Also returned, with `accessRefused: true` and `reason: "access-refused"`, when the caller is signed in but not admitted by the invite gate; the gate runs before the handler, so this applies to every method. A deployment with no sign-in configured answers 403 with `reason: "not-configured"`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthRefusal',
                },
              },
            },
          },
          '405': {
            description:
              'Any method other than POST (`{"error": "Use POST."}`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '409': {
            description:
              'The project has no usable binding (none, revoked or expired; `reconnect: true`), or GitHub refused or could not find the repository (`reconnect: true` only when the grant is gone).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/GitHubProblem',
                },
              },
            },
          },
          '413': {
            description:
              'Too many files (more than 50), a path longer than 256 characters, or too many path or content characters in total.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '429': {
            description:
              'The caller exceeded the GitHub rate limit, or GitHub rate-limited the request.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/GitHubProblem',
                },
              },
            },
          },
          '502': {
            description:
              'GitHub was unreachable, refused, or answered unreadably.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/GitHubProblem',
                },
              },
            },
          },
          '503': {
            description:
              'Pushing to GitHub is not configured (App credentials or D1 missing), GitHub configuration failed, or the account check against D1 failed.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/github/disconnect': {
      post: {
        operationId: 'disconnectGitHubRepository',
        summary: "Revoke one project's repository binding.",
        description:
          'Not behind the invite gate. The request must name the repository it expects to disconnect. Answers `{ "connected": false }` whether or not anything was bound.',
        tags: ['GitHub'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/GitHubDisconnectRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'The project has no usable binding.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/GitHubDisconnected',
                },
              },
            },
          },
          '400': {
            description:
              'The body is not valid JSON; `owner` or `repo` is missing or empty; or `projectId` is missing or not a project id (the page is out of date).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '401': {
            description: 'No sign-in was sent (`reason: "not-signed-in"`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthRefusal',
                },
              },
            },
          },
          '403': {
            description:
              'The token failed verification (`reason: "not-signed-in"`), the account is banned (`reason: "account-banned"`), or it is scheduled for deletion (`reason: "deletion-scheduled"`, with `purgeAfter`). A deployment with no sign-in configured answers 403 with `reason: "not-configured"`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthRefusal',
                },
              },
            },
          },
          '405': {
            description:
              'Any method other than POST (`{"error": "Use POST."}`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '409': {
            description:
              'The project is bound to a different repository than the one named, or the binding changed while the request ran; nothing was disconnected. `movedTo` names the current binding.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/GitHubProblem',
                },
              },
            },
          },
          '503': {
            description:
              'GitHub is not configured for this deployment, or the account check against D1 failed.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/github/disconnect-account': {
      post: {
        operationId: 'disconnectGitHubAccount',
        summary:
          "Disconnect the caller's GitHub sign-in and every project's repository binding.",
        description:
          'Not behind the invite gate. No request body is read. The same answer whether or not anything was connected.',
        tags: ['GitHub'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        responses: {
          '200': {
            description: 'The account is disconnected.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/GitHubDisconnected',
                },
              },
            },
          },
          '401': {
            description: 'No sign-in was sent (`reason: "not-signed-in"`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthRefusal',
                },
              },
            },
          },
          '403': {
            description:
              'The token failed verification (`reason: "not-signed-in"`), the account is banned (`reason: "account-banned"`), or it is scheduled for deletion (`reason: "deletion-scheduled"`, with `purgeAfter`). A deployment with no sign-in configured answers 403 with `reason: "not-configured"`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthRefusal',
                },
              },
            },
          },
          '405': {
            description:
              'Any method other than POST (`{"error": "Use POST."}`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'GitHub is not configured for this deployment, or the account check against D1 failed.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/github/push': {
      post: {
        operationId: 'pushGitHubCheckpoint',
        summary:
          "Push an accepted checkpoint's files to a branch in the project's connected repository and open a pull request.",
        description:
          'Behind the invite gate. The branch is `vibld/<revision>`. The request must name the repository it expects; a push whose destination has moved is refused. Idempotent per caller, repository and revision: a retry reuses the recorded base commit, and `created` is `false` when the branch already held this tree.',
        tags: ['GitHub'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/GitHubPushRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'The branch and commit that were pushed.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/GitHubPushResponse',
                },
              },
            },
          },
          '400': {
            description:
              'The body is not valid JSON or not an object; `projectId` is missing or not a project id (the page is out of date); `files` is empty or malformed; `revision` cannot become a branch; `owner` or `repo` is missing or empty; or GitHub reported the request as invalid.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/GitHubProblem',
                },
              },
            },
          },
          '401': {
            description: 'No sign-in was sent (`reason: "not-signed-in"`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthRefusal',
                },
              },
            },
          },
          '403': {
            description:
              'The token failed verification (`reason: "not-signed-in"`), the account is banned (`reason: "account-banned"`), or it is scheduled for deletion (`reason: "deletion-scheduled"`, with `purgeAfter`). Also returned, with `accessRefused: true` and `reason: "access-refused"`, when the caller is signed in but not admitted by the invite gate; the gate runs before the handler, so this applies to every method. A deployment with no sign-in configured answers 403 with `reason: "not-configured"`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthRefusal',
                },
              },
            },
          },
          '405': {
            description:
              'Any method other than POST (`{"error": "Use POST."}`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '409': {
            description:
              'The project has no usable binding (`reconnect: true`); the binding is a different repository than the one named (`movedTo`); the branch already exists with different content (`conflict`); or GitHub refused or could not find the repository (`reconnect: true` only when the grant is gone).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/GitHubProblem',
                },
              },
            },
          },
          '413': {
            description:
              'Too many files (more than 50), a path longer than 256 characters, or too many path or content characters in total.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '429': {
            description:
              'The caller exceeded the GitHub push rate limit, or GitHub rate-limited the request.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/GitHubProblem',
                },
              },
            },
          },
          '502': {
            description:
              'GitHub was unreachable, refused, or answered unreadably.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/GitHubProblem',
                },
              },
            },
          },
          '503': {
            description:
              'Pushing to GitHub is not configured (App credentials or D1 missing), GitHub configuration failed, or the account check against D1 failed.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/github/status': {
      get: {
        operationId: 'getGitHubStatus',
        summary:
          "Report GitHub configuration, the caller's account connection, and a project's repository binding.",
        description:
          'Not behind the invite gate. When neither GitHub half is configured the answer is `{ "configured": false, "canPush": false, "canConnect": false }`. Without `project` the answer covers the account only and reports `connected: false` with `reason: "none"`.',
        tags: ['GitHub'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [
          {
            name: 'project',
            in: 'query',
            required: false,
            description: 'The project whose binding to report.',
            schema: {
              $ref: '#/components/schemas/ProjectId',
            },
          },
        ],
        responses: {
          '200': {
            description: 'The connection status.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/GitHubStatus',
                },
              },
            },
          },
          '400': {
            description: '`project` is present but not a project id.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '401': {
            description: 'No sign-in was sent (`reason: "not-signed-in"`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthRefusal',
                },
              },
            },
          },
          '403': {
            description:
              'The token failed verification (`reason: "not-signed-in"`), the account is banned (`reason: "account-banned"`), or it is scheduled for deletion (`reason: "deletion-scheduled"`, with `purgeAfter`). A deployment with no sign-in configured answers 403 with `reason: "not-configured"`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthRefusal',
                },
              },
            },
          },
          '405': {
            description: 'Any method other than GET (`{"error": "Use GET."}`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description: 'The account check against D1 failed.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/health': {
      get: {
        operationId: 'getHealth',
        summary: 'Whether the builder API is answering.',
        description:
          'A liveness check. It touches no stored state, so it says nothing about any dependency.',
        tags: ['Meta'],
        security: [],
        responses: {
          '200': {
            description: 'The API is answering.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Health',
                },
              },
            },
          },
          '405': {
            description: 'Any method but GET or HEAD.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
      head: {
        operationId: 'headHealth',
        summary: 'Whether the builder API is answering, with no body.',
        tags: ['Meta'],
        security: [],
        responses: {
          '200': {
            description: 'The API is answering.',
          },
        },
      },
    },
    '/api/media': {
      get: {
        operationId: 'listMedia',
        summary:
          "List the caller's media library and its usage against the account limits.",
        description:
          'Not behind the invite gate. The library belongs to the account and is shared by all of its projects.',
        tags: ['Media'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        responses: {
          '200': {
            description: 'The library.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/MediaLibrary',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names (reason `not-signed-in`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '403': {
            description:
              'Refused before the handler runs: sign-in is not configured for this deployment (`not-configured`), the token failed verification (`not-signed-in`), the account is banned (`account-banned`) or scheduled for deletion (`deletion-scheduled`, with `purgeAfter`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '405': {
            description:
              'A method other than GET, POST or DELETE (answered before identity).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Media is not configured for this deployment (checked before identity and method), or the account could not be checked for a ban or a pending deletion.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'uploadMedia',
        summary:
          "Upload one image or video file to the caller's media library.",
        description:
          'Behind the invite gate. The body is the raw file. Its type is decided by sniffing the bytes, not by the Content-Type, which only has to be an image, video or octet-stream type. Accepted: JPEG, PNG, GIF, WebP and AVIF images (8 MB each) and MP4 or WebM video (40 MB each); an account holds at most 30 files and 200 MB. The invite gate resolves the caller first; the handler then checks Content-Type, Origin and declared size before reading the body.',
        tags: ['Media'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [
          {
            name: 'x-media-name',
            in: 'header',
            required: false,
            description:
              'URI-encoded name the stored path is derived from. Defaults to "media".',
            schema: {
              type: 'string',
            },
          },
          {
            name: 'x-media-alt',
            in: 'header',
            required: false,
            description:
              'URI-encoded alt text. Reduced to one line, control characters removed, at most 300 characters.',
            schema: {
              type: 'string',
            },
          },
          {
            name: 'x-media-poster-for',
            in: 'header',
            required: false,
            description:
              "URI-encoded id of a video in the caller's library. The uploaded file must be an image, and becomes that video's poster.",
            schema: {
              type: 'string',
            },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'image/*': {
              schema: {},
            },
            'video/*': {
              schema: {},
            },
            'application/octet-stream': {
              schema: {},
            },
          },
        },
        responses: {
          '201': {
            description: 'Stored.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/MediaUploaded',
                },
              },
            },
          },
          '400': {
            description:
              'The body is empty, or `x-media-poster-for` is given and the file is not an image.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names (reason `not-signed-in`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '403': {
            description:
              'Cross-site Origin (plain error, no reason), or an identity refusal. Also the invite gate: a signed-in caller who has not been invited gets `accessRefused: true` and reason `access-refused`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '404': {
            description:
              "`x-media-poster-for` does not name a video in the caller's library.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '409': {
            description:
              'The library already holds 30 files, or storing this would pass the file or byte limit.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '413': {
            description:
              'Declared or actual size over 40 MB, over the per-kind limit (images 8 MB), or past the 200 MB the account may hold.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '415': {
            description:
              'Content-Type is not an image, video or octet-stream type, or the bytes are not a supported image or video format.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '429': {
            description: 'Too many uploads from this account.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Media is not configured here, the file could not be stored, or the account could not be checked for a ban or a pending deletion (the database did not answer).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
      delete: {
        operationId: 'deleteMedia',
        summary: "Remove one file from the caller's media library.",
        description:
          'Not behind the invite gate: a revoked account can still take its uploads down.',
        tags: ['Media'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [
          {
            name: 'id',
            in: 'query',
            required: true,
            description: "The media entry's id.",
            schema: {
              type: 'string',
            },
          },
        ],
        responses: {
          '200': {
            description: 'Removed.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/MediaRemoved',
                },
              },
            },
          },
          '400': {
            description: '`id` is missing.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names (reason `not-signed-in`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '403': {
            description:
              'Refused before the handler runs: sign-in is not configured for this deployment (`not-configured`), the token failed verification (`not-signed-in`), the account is banned (`account-banned`) or scheduled for deletion (`deletion-scheduled`, with `purgeAfter`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '404': {
            description: "No file with that id in the caller's library.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Media is not configured here, the removal failed, or the account could not be checked for a ban or a pending deletion (the database did not answer).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/media/file': {
      get: {
        operationId: 'getMediaFile',
        summary: "Download one file of the caller's own media library.",
        description:
          'Not behind the invite gate. Always the whole file (status 200, no range support here), with `cache-control: private, no-store`, `accept-ranges: bytes`, `content-length` and `x-content-type-options: nosniff`.',
        tags: ['Media'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [
          {
            name: 'path',
            in: 'query',
            required: true,
            description:
              'A library path: `media/<slug>.<ext>` where ext is jpg, png, gif, webp, avif, mp4 or webm.',
            schema: {
              type: 'string',
              pattern:
                '^media/[a-z0-9]+(?:-[a-z0-9]+)*\\.(jpg|png|gif|webp|avif|mp4|webm)$',
            },
          },
        ],
        responses: {
          '200': {
            description: "The file's bytes, with its stored content type.",
            content: {
              'image/*': {
                schema: {},
              },
              'video/*': {
                schema: {},
              },
            },
          },
          '400': {
            description:
              '`path` is not a media path (checked before identity).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names (reason `not-signed-in`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '403': {
            description:
              'Refused before the handler runs: sign-in is not configured for this deployment (`not-configured`), the token failed verification (`not-signed-in`), the account is banned (`account-banned`) or scheduled for deletion (`deletion-scheduled`, with `purgeAfter`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '404': {
            description: "No such file in the caller's library.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '405': {
            description:
              'Method other than GET or HEAD (checked before configuration and identity).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Media is not configured here, or the account could not be checked for a ban or a pending deletion (the database did not answer).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
      head: {
        operationId: 'headMediaFile',
        summary:
          "Read the headers of one file of the caller's media library without its body.",
        tags: ['Media'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [
          {
            name: 'path',
            in: 'query',
            required: true,
            description:
              'A library path: `media/<slug>.<ext>` where ext is jpg, png, gif, webp, avif, mp4 or webm.',
            schema: {
              type: 'string',
              pattern:
                '^media/[a-z0-9]+(?:-[a-z0-9]+)*\\.(jpg|png|gif|webp|avif|mp4|webm)$',
            },
          },
        ],
        responses: {
          '200': {
            description: 'The headers a GET would send, with no body.',
          },
          '400': {
            description:
              '`path` is not a media path (checked before identity).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names (reason `not-signed-in`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '403': {
            description:
              'Refused before the handler runs: sign-in is not configured for this deployment (`not-configured`), the token failed verification (`not-signed-in`), the account is banned (`account-banned`) or scheduled for deletion (`deletion-scheduled`, with `purgeAfter`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '404': {
            description: "No such file in the caller's library.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '405': {
            description:
              'Method other than GET or HEAD (checked before configuration and identity).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Media is not configured here, or the account could not be checked for a ban or a pending deletion (the database did not answer).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/mockups': {
      post: {
        operationId: 'generateMockups',
        summary:
          'Generate design directions (or one draft) for a prompt and stream the result.',
        description:
          "Behind the invite gate for every method. Runs in the request, not a Workflow: leaving the stream cancels the model call. Sends `: keepalive` comments, `progress` events with streamed character counts, and ends with one `mockups` or one `error` event. With `draft: true` it produces one direction, drawn on the deployment's draft model where the caller may use it.",
        tags: ['Building'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/MockupRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'The mockup stream.',
            content: {
              'text/event-stream': {
                schema: {
                  type: 'string',
                  description: 'Server-sent events.',
                },
                'x-sse-events': {
                  progress: {
                    $ref: '#/components/schemas/MockupProgressEvent',
                  },
                  mockups: {
                    $ref: '#/components/schemas/MockupsEvent',
                  },
                  error: {
                    $ref: '#/components/schemas/StreamErrorEvent',
                  },
                },
              },
            },
          },
          '400': {
            description:
              'Body is not valid JSON or fails validation, an unknown `style`, `galleryStyle` or `model`, a gallery style no longer present, or color edits that fail its contrast checks (reason `request-invalid`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names (reason `not-signed-in`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '403': {
            description:
              'Cross-site Origin (`request-invalid`), model not allowed (`model-not-allowed`), account suspended (`account-suspended`), or an identity refusal. Also the invite gate: a signed-in caller who has not been invited gets `accessRefused: true` and reason `access-refused`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '405': {
            description:
              'Method other than POST (answered after the invite gate).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '413': {
            description:
              'Declared body over 256 KiB, or `prompt` over its limit (reason `request-invalid`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '415': {
            description:
              'Content-Type is not application/json (reason `request-invalid`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '429': {
            description:
              'Rate limited (`rate-limited`), not enough budget (`account-ceiling`), or a generation already running (`already-running`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '503': {
            description:
              'Generation is not configured here (plain error, no reason), usage accounting is unavailable (`accounting-unavailable`, `retry-after: 30`), or the chosen model cannot be served (`model-not-allowed`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
        },
      },
    },
    '/api/openapi.json': {
      get: {
        operationId: 'getOpenApi',
        summary: 'This document.',
        description: 'The OpenAPI 3.1 description of the builder API.',
        tags: ['Meta'],
        security: [],
        responses: {
          '200': {
            description: 'The document.',
            content: {
              'application/vnd.oai.openapi+json': {
                schema: {
                  type: 'object',
                },
              },
            },
          },
          '405': {
            description: 'Any method but GET or HEAD.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
      head: {
        operationId: 'headOpenApi',
        summary: "This document's headers, with no body.",
        tags: ['Meta'],
        security: [],
        responses: {
          '200': {
            description: 'The headers the document is sent with.',
          },
        },
      },
    },
    '/api/owner/session': {
      get: {
        operationId: 'getOwnerSession',
        summary:
          'Report whether the owner session cookie on this request is valid.',
        description:
          'Only on a self-hosted deployment in owner sign-in mode; every other deployment answers 404. Authenticated by the `vibld_owner` cookie, not a bearer token. Sent with `cache-control: no-store`.',
        tags: ['Account'],
        security: [],
        parameters: [],
        responses: {
          '200': {
            description: 'Whether the owner is signed in.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/OwnerSessionState',
                },
              },
            },
          },
          '404': {
            description:
              'This deployment does not use owner sign-in, or owner sign-in is not configured.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createOwnerSession',
        summary: 'Sign in as the deployment owner with the owner password.',
        description:
          'On success sets the `vibld_owner` cookie (HttpOnly, SameSite=Strict, Path=/, Max-Age 30 days, Secure over https). Counted per client address. The body is read up to 4096 bytes.',
        tags: ['Account'],
        security: [],
        parameters: [
          {
            name: 'Origin',
            in: 'header',
            required: true,
            description:
              "This deployment's own origin, such as `https://builder.example.com`. A write with no `Origin`, or another host's, is refused 403 before the password is read.",
            schema: {
              type: 'string',
              format: 'uri',
            },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/OwnerSessionRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Signed in; the session cookie is set.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/OwnerSessionState',
                },
              },
            },
          },
          '400': {
            description:
              'No password given, or the body is not JSON with a non-empty string `password`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '401': {
            description: 'The password is wrong.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '403': {
            description:
              'A non-GET request whose Origin header is missing or names another host.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '404': {
            description:
              'This deployment does not use owner sign-in, or owner sign-in is not configured.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '413': {
            description: 'The body is larger than 4096 bytes.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '429': {
            description:
              'Too many sign-in attempts from this address. Sent with `retry-after: 60`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
      delete: {
        operationId: 'deleteOwnerSession',
        summary: 'Sign the owner out by clearing the session cookie.',
        tags: ['Account'],
        security: [],
        parameters: [
          {
            name: 'Origin',
            in: 'header',
            required: true,
            description:
              "This deployment's own origin, such as `https://builder.example.com`. A write with no `Origin`, or another host's, is refused 403 before the password is read.",
            schema: {
              type: 'string',
              format: 'uri',
            },
          },
        ],
        responses: {
          '200': {
            description: 'Signed out; the cookie is cleared.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/OwnerSessionState',
                },
              },
            },
          },
          '403': {
            description:
              'A non-GET request whose Origin header is missing or names another host.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '404': {
            description:
              'This deployment does not use owner sign-in, or owner sign-in is not configured.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/plan': {
      post: {
        operationId: 'startBuild',
        summary:
          "Start a build of the caller's project from a prompt and stream its progress and result.",
        description:
          'Behind the invite gate for every method, which resolves the caller and checks the invite before the handler runs. The handler then checks, in order: content type and origin, body size, a per-address limit, deployment configuration, identity again, then the body. The build runs in a durable Workflow; leaving the stream does not cancel it (use `DELETE /api/runs/{id}`). The stream sends `: keepalive` comments on a timer, then a `run` event with the run id, `progress` events while it runs, and ends with one `plan` or one `error` event.',
        tags: ['Building'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/BuildRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'The build stream.',
            content: {
              'text/event-stream': {
                schema: {
                  type: 'string',
                  description: 'Server-sent events.',
                },
                'x-sse-events': {
                  run: {
                    $ref: '#/components/schemas/BuildRunEvent',
                  },
                  progress: {
                    $ref: '#/components/schemas/BuildProgressEvent',
                  },
                  plan: {
                    $ref: '#/components/schemas/BuildPlanEvent',
                  },
                  error: {
                    $ref: '#/components/schemas/StreamErrorEvent',
                  },
                },
              },
            },
          },
          '400': {
            description:
              "Body is not valid JSON or fails validation, an unknown `style`, `galleryStyle`, `model` or malformed `projectId`, a gallery style no longer present, or color edits that fail the style's contrast checks (reason `request-invalid`).",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names (reason `not-signed-in`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '403': {
            description:
              'Cross-site Origin (`request-invalid`); generation not configured (`not-configured`); the model is not allowed for this caller or plan (`model-not-allowed`); the account is suspended after a lost payment dispute (`account-suspended`); or an identity refusal as for every authenticated route. Also the invite gate: a signed-in caller who has not been invited gets `accessRefused: true` and reason `access-refused`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '404': {
            description:
              "`projectId` names a project that is not the caller's (reason `request-invalid`).",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '405': {
            description:
              'Method other than POST (answered after the invite gate).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '409': {
            description:
              '`projectId` names an archived project (reason `request-invalid`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '413': {
            description:
              'Declared body over 256 KiB, or a field over its documented limit (reason `request-invalid`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '415': {
            description:
              'Content-Type is not application/json (reason `request-invalid`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '422': {
            description:
              'The reference page named in `referenceUrl` could not be fetched (reason `request-invalid`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '429': {
            description:
              'Rate limited per address or per user (`rate-limited`), not enough budget left for the smallest build (`account-ceiling`), or a generation already running (`already-running`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '503': {
            description:
              'Usage accounting unavailable (`accounting-unavailable`, with `retry-after: 30`), the chosen model cannot be served here (`model-not-allowed`), the project lookup failed, or the run could not be started.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
        },
      },
    },
    '/api/preview': {
      get: {
        operationId: 'getPreviewStatus',
        summary: "Get the status of the caller's live preview sandbox.",
        description: 'Not behind the invite gate.',
        tags: ['Building'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        responses: {
          '200': {
            description: "The preview's status.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/PreviewStatus',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names (reason `not-signed-in`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '403': {
            description:
              'Refused before the handler runs: sign-in is not configured for this deployment (`not-configured`), the token failed verification (`not-signed-in`), the account is banned (`account-banned`) or scheduled for deletion (`deletion-scheduled`, with `purgeAfter`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '502': {
            description: "The preview service's answer could not be read.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Preview is not configured for this deployment (checked before identity and method), or the account could not be checked for a ban or a pending deletion.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'startPreview',
        summary:
          'Start a live preview of the given project files in a sandbox.',
        description:
          "Behind the invite gate. The service's answer is passed through with status 200, including a `failed` status.",
        tags: ['Building'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/PreviewStartRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description: "The preview's status after the start.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/PreviewStatus',
                },
              },
            },
          },
          '400': {
            description:
              'Body is not valid JSON, `files` is missing, empty or malformed, a path is not relative and canonical, or `revision` is not a string of 1 to 200 characters.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names (reason `not-signed-in`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '403': {
            description:
              'Refused before the handler runs: sign-in is not configured for this deployment (`not-configured`), the token failed verification (`not-signed-in`), the account is banned (`account-banned`) or scheduled for deletion (`deletion-scheduled`, with `purgeAfter`). Also the invite gate: a signed-in caller who has not been invited gets `accessRefused: true` and reason `access-refused`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '413': {
            description:
              'More than 50 files, a path over 256 characters, or too many path or content characters in total.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Preview is not configured for this deployment (checked before identity and method), or the account could not be checked for a ban or a pending deletion.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
      patch: {
        operationId: 'updatePreview',
        summary:
          'Write a new revision of the project into the preview that is already running.',
        description:
          'Behind the invite gate. Any refusal from the preview service is answered 502, which the builder treats as a cue to restart the preview instead.',
        tags: ['Building'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/PreviewUpdateRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'What became of the update.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/PreviewUpdate',
                },
              },
            },
          },
          '400': {
            description:
              'Body is not valid JSON, `files` is missing, empty or malformed, or `revision` is missing or not a string of 1 to 200 characters.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names (reason `not-signed-in`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '403': {
            description:
              'Refused before the handler runs: sign-in is not configured for this deployment (`not-configured`), the token failed verification (`not-signed-in`), the account is banned (`account-banned`) or scheduled for deletion (`deletion-scheduled`, with `purgeAfter`). Also the invite gate: a signed-in caller who has not been invited gets `accessRefused: true` and reason `access-refused`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '413': {
            description:
              'More than 50 files, a path over 256 characters, or too many path or content characters in total.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '502': {
            description:
              'The preview service refused the update or answered unreadably.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Preview is not configured for this deployment (checked before identity and method), or the account could not be checked for a ban or a pending deletion.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
      delete: {
        operationId: 'stopPreview',
        summary: "Stop the caller's running preview.",
        description:
          'Not behind the invite gate: an owner must always be able to stop their own preview.',
        tags: ['Building'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        responses: {
          '200': {
            description: 'Stopped.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/OkResult',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names (reason `not-signed-in`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '403': {
            description:
              'Refused before the handler runs: sign-in is not configured for this deployment (`not-configured`), the token failed verification (`not-signed-in`), the account is banned (`account-banned`) or scheduled for deletion (`deletion-scheduled`, with `purgeAfter`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '502': {
            description: 'The preview service could not stop it.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Preview is not configured for this deployment (checked before identity and method), or the account could not be checked for a ban or a pending deletion.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/preview/share': {
      get: {
        operationId: 'listPreviewShares',
        summary: "List the share links of the caller's preview.",
        description:
          'Not behind the invite gate. A service answer that cannot be read is reported as an empty list.',
        tags: ['Publishing'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        responses: {
          '200': {
            description: "The caller's preview share links.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/PreviewShareList',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names (reason `not-signed-in`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '403': {
            description:
              'Refused before the handler runs: sign-in is not configured for this deployment (`not-configured`), the token failed verification (`not-signed-in`), the account is banned (`account-banned`) or scheduled for deletion (`deletion-scheduled`, with `purgeAfter`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '503': {
            description:
              'Preview is not configured for this deployment (checked before identity and method), or the account could not be checked for a ban or a pending deletion.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createPreviewShare',
        summary: "Create a public share link to the caller's running preview.",
        description: 'Behind the invite gate. No request body is read.',
        tags: ['Publishing'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        responses: {
          '200': {
            description: 'The new share link.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/PreviewShareCreated',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names (reason `not-signed-in`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '403': {
            description:
              'Refused before the handler runs: sign-in is not configured for this deployment (`not-configured`), the token failed verification (`not-signed-in`), the account is banned (`account-banned`) or scheduled for deletion (`deletion-scheduled`, with `purgeAfter`). Also the invite gate: a signed-in caller who has not been invited gets `accessRefused: true` and reason `access-refused`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '409': {
            description:
              'The preview service did not create a link (for example, no preview running), or its answer could not be read.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Preview is not configured for this deployment (checked before identity and method), or the account could not be checked for a ban or a pending deletion.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
      delete: {
        operationId: 'revokePreviewShare',
        summary: "Revoke one of the caller's preview share links.",
        description:
          'Not behind the invite gate: a revoked owner can still pull a link.',
        tags: ['Publishing'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/PreviewShareRevokeRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Revoked.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/OkResult',
                },
              },
            },
          },
          '400': {
            description:
              'Body is not valid JSON, or `shareId` is missing or empty.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names (reason `not-signed-in`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '403': {
            description:
              'Refused before the handler runs: sign-in is not configured for this deployment (`not-configured`), the token failed verification (`not-signed-in`), the account is banned (`account-banned`) or scheduled for deletion (`deletion-scheduled`, with `purgeAfter`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '502': {
            description: 'The preview service could not revoke the link.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Preview is not configured for this deployment (checked before identity and method), or the account could not be checked for a ban or a pending deletion.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/projects': {
      get: {
        operationId: 'listProjects',
        summary:
          'List every project the caller owns, active and archived, with their active project limit.',
        tags: ['Projects'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        responses: {
          '200': {
            description: "The caller's projects.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ProjectList',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names. The body also carries `reason: "not-signed-in"`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '403': {
            description:
              'Refused: the session token failed verification (`reason: "not-signed-in"`), the account is banned (`reason: "account-banned"`), the account is scheduled for deletion (`reason: "deletion-scheduled"`, with `purgeAfter`), or sign-in is not configured on this deployment (`reason: "not-configured"`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '405': {
            description:
              'Method not allowed. The error text names the accepted methods (GET, POST).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Projects are not configured for this deployment (no D1 or R2 binding), or the account could not be checked right now.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createProject',
        summary: "Create a project, held to the caller's active project limit.",
        description:
          'Invite-gated. On this method the invite gate also applies: a signed-in caller who has not been invited gets 403 with `accessRefused: true` and `reason: "access-refused"`.',
        tags: ['Projects'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        requestBody: {
          required: true,
          description:
            'A JSON object; `{}` is accepted. A JSON `null` body is treated as `{}`.',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ProjectCreateRequest',
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'The new project.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ProjectEnvelope',
                },
              },
            },
          },
          '400': {
            description:
              'The body is not valid JSON, is not an object, or the settings are invalid.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names. The body also carries `reason: "not-signed-in"`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '403': {
            description:
              'Either the active project limit is reached (`code: "project-limit"`), a cross-site Origin was sent, or the caller was refused by identity or the invite gate (see the 401 and 403 notes on other operations). On this method the invite gate also applies: a signed-in caller who has not been invited gets 403 with `accessRefused: true` and `reason: "access-refused"`.',
            content: {
              'application/json': {
                schema: {
                  anyOf: [
                    {
                      $ref: '#/components/schemas/ProjectLimitError',
                    },
                    {
                      $ref: '#/components/schemas/Error',
                    },
                  ],
                },
              },
            },
          },
          '413': {
            description:
              'The declared Content-Length is over the body limit for project writes, or the conversation is too long to save.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '415': {
            description:
              'The Content-Type header is not application/json. Checked on every POST and PATCH here, including ones that send no body.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Projects are not configured for this deployment (no D1 or R2 binding), or the account could not be checked right now.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/projects/{id}': {
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description:
            'The project id. An id that does not match the pattern, or names a project the caller does not own, is answered 404 (never 403).',
          schema: {
            type: 'string',
            pattern: '^[A-Za-z0-9_-]{1,128}$',
          },
        },
      ],
      get: {
        operationId: 'getProject',
        summary:
          'Open a project: its view, conversation, accepted code and any build still running in it.',
        description:
          'Also records the project as opened now, which orders the project list.',
        tags: ['Projects'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        responses: {
          '200': {
            description: 'The project.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ProjectDetail',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names. The body also carries `reason: "not-signed-in"`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '403': {
            description:
              'Refused: the session token failed verification (`reason: "not-signed-in"`), the account is banned (`reason: "account-banned"`), the account is scheduled for deletion (`reason: "deletion-scheduled"`, with `purgeAfter`), or sign-in is not configured on this deployment (`reason: "not-configured"`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '404': {
            description: "The project does not exist or is not the caller's.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '405': {
            description:
              'Method not allowed. The error text names the accepted methods (GET, PATCH, DELETE).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Projects are not configured for this deployment (no D1 or R2 binding), or the account could not be checked right now.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
      patch: {
        operationId: 'updateProject',
        summary:
          'Rename, archive or unarchive a project, or save its settings and conversation.',
        tags: ['Projects'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ProjectPatchRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'The project after the change.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ProjectEnvelope',
                },
              },
            },
          },
          '400': {
            description: 'The body is not valid JSON or a field is invalid.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names. The body also carries `reason: "not-signed-in"`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '403': {
            description:
              'Unarchiving would pass the active project limit (`code: "project-limit"`), a cross-site Origin was sent, or the caller was refused by identity.',
            content: {
              'application/json': {
                schema: {
                  anyOf: [
                    {
                      $ref: '#/components/schemas/ProjectLimitError',
                    },
                    {
                      $ref: '#/components/schemas/Error',
                    },
                  ],
                },
              },
            },
          },
          '404': {
            description: "The project does not exist or is not the caller's.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '409': {
            description:
              'The settings or conversation were saved from somewhere else since the named `version`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ProjectChangedError',
                },
              },
            },
          },
          '413': {
            description:
              'The declared Content-Length is over the body limit for project writes, or the conversation is too long to save.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '415': {
            description:
              'The Content-Type header is not application/json. Checked on every POST and PATCH here, including ones that send no body.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Projects are not configured for this deployment (no D1 or R2 binding), or the account could not be checked right now.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
      delete: {
        operationId: 'deleteProject',
        summary:
          'Delete a project with its code, share link and published site.',
        description:
          'A live published site is taken down first; if it cannot be, nothing is deleted. Any share link is turned off before content is removed.',
        tags: ['Projects'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        responses: {
          '200': {
            description: 'The project was deleted.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['deleted'],
                  properties: {
                    deleted: {
                      const: true,
                    },
                  },
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names. The body also carries `reason: "not-signed-in"`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '403': {
            description:
              'A cross-site Origin was sent, or the caller was refused by identity. Refused: the session token failed verification (`reason: "not-signed-in"`), the account is banned (`reason: "account-banned"`), the account is scheduled for deletion (`reason: "deletion-scheduled"`, with `purgeAfter`), or sign-in is not configured on this deployment (`reason: "not-configured"`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '404': {
            description: "The project does not exist or is not the caller's.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '409': {
            description:
              'A build is still running in the project, or its published site is still online and could not be taken down.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'The project is large and was only partly deleted (repeat the request to finish), or projects are not configured, or the account could not be checked.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/projects/{id}/checkpoints': {
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description:
            'The project id. An id that does not match the pattern, or names a project the caller does not own, is answered 404 (never 403).',
          schema: {
            type: 'string',
            pattern: '^[A-Za-z0-9_-]{1,128}$',
          },
        },
      ],
      get: {
        operationId: 'listProjectCheckpoints',
        summary:
          "List a project's accepted checkpoints, newest first, with the accepted revision now.",
        tags: ['Projects'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        responses: {
          '200': {
            description: 'The checkpoint history (at most 100 entries).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/CheckpointHistory',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names. The body also carries `reason: "not-signed-in"`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '403': {
            description:
              'Refused: the session token failed verification (`reason: "not-signed-in"`), the account is banned (`reason: "account-banned"`), the account is scheduled for deletion (`reason: "deletion-scheduled"`, with `purgeAfter`), or sign-in is not configured on this deployment (`reason: "not-configured"`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '404': {
            description: "The project does not exist or is not the caller's.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '405': {
            description:
              'Method not allowed. The error text names the accepted methods (GET).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Projects are not configured for this deployment (no D1 or R2 binding), or the account could not be checked right now.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/projects/{id}/checkpoints/restore': {
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description:
            'The project id. An id that does not match the pattern, or names a project the caller does not own, is answered 404 (never 403).',
          schema: {
            type: 'string',
            pattern: '^[A-Za-z0-9_-]{1,128}$',
          },
        },
      ],
      post: {
        operationId: 'restoreProjectCheckpoint',
        summary:
          "Make one of a project's accepted checkpoints the accepted one again and return its code.",
        description:
          'Spends nothing and publishes nothing. Restoring the revision that is already accepted is answered as done without writing.',
        tags: ['Projects'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/CheckpointRestoreRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'The restored code.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/SnapshotEnvelope',
                },
              },
            },
          },
          '400': {
            description:
              'The body is not valid JSON, `revision` is not a checkpoint id, or `base` is neither a revision nor null.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names. The body also carries `reason: "not-signed-in"`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '403': {
            description:
              'Refused: the session token failed verification (`reason: "not-signed-in"`), the account is banned (`reason: "account-banned"`), the account is scheduled for deletion (`reason: "deletion-scheduled"`, with `purgeAfter`), or sign-in is not configured on this deployment (`reason: "not-configured"`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '404': {
            description:
              "The project does not exist or is not the caller's, the checkpoint is not in its history, or the checkpoint is no longer stored.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '405': {
            description:
              'Method not allowed. The error text names the accepted methods (POST).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '409': {
            description:
              'The project is archived, a build is still running in it, or the accepted revision is no longer `base` (`code: "checkpoint-moved"`, with `current`).',
            content: {
              'application/json': {
                schema: {
                  anyOf: [
                    {
                      $ref: '#/components/schemas/CheckpointMovedError',
                    },
                    {
                      $ref: '#/components/schemas/Error',
                    },
                  ],
                },
              },
            },
          },
          '413': {
            description:
              'The declared Content-Length is over the body limit for project writes, or the conversation is too long to save.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '415': {
            description:
              'The Content-Type header is not application/json. Checked on every POST and PATCH here, including ones that send no body.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Projects are not configured for this deployment (no D1 or R2 binding), or the account could not be checked right now.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/projects/{id}/duplicate': {
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description:
            'The project id. An id that does not match the pattern, or names a project the caller does not own, is answered 404 (never 403).',
          schema: {
            type: 'string',
            pattern: '^[A-Za-z0-9_-]{1,128}$',
          },
        },
      ],
      post: {
        operationId: 'duplicateProject',
        summary:
          'Copy a project into a new one named as a copy, held to the active project limit.',
        description:
          'Invite-gated. On this method the invite gate also applies: a signed-in caller who has not been invited gets 403 with `accessRefused: true` and `reason: "access-refused"`.',
        tags: ['Projects'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        requestBody: {
          required: true,
          description:
            'Send `{}`. The body is not read, but the request must carry `Content-Type: application/json` or it is refused with 415.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'The copy.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ProjectEnvelope',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names. The body also carries `reason: "not-signed-in"`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '403': {
            description:
              'The active project limit is reached (`code: "project-limit"`), a cross-site Origin was sent, or the caller was refused by identity or the invite gate.',
            content: {
              'application/json': {
                schema: {
                  anyOf: [
                    {
                      $ref: '#/components/schemas/ProjectLimitError',
                    },
                    {
                      $ref: '#/components/schemas/Error',
                    },
                  ],
                },
              },
            },
          },
          '404': {
            description: "The project does not exist or is not the caller's.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '405': {
            description:
              'Method not allowed. The error text names the accepted methods (POST).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '413': {
            description:
              'The declared Content-Length is over the body limit for project writes, or the conversation is too long to save.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '415': {
            description:
              'The Content-Type header is not application/json. Checked on every POST and PATCH here, including ones that send no body.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Projects are not configured for this deployment (no D1 or R2 binding), or the account could not be checked right now.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/projects/{id}/share': {
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description:
            'The project id. An id that does not match the pattern, or names a project the caller does not own, is answered 404 (never 403).',
          schema: {
            type: 'string',
            pattern: '^[A-Za-z0-9_-]{1,128}$',
          },
        },
      ],
      post: {
        operationId: 'enableProjectShare',
        summary: "Turn a project's share link on.",
        description:
          'Invite-gated. On this method the invite gate also applies: a signed-in caller who has not been invited gets 403 with `accessRefused: true` and `reason: "access-refused"`. Turning on a link that is already on answers with the project as it is.',
        tags: ['Sharing'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        requestBody: {
          required: true,
          description:
            'Send `{}`. The body is not read, but the request must carry `Content-Type: application/json` or it is refused with 415.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'The project, with `share.url` set.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ProjectEnvelope',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names. The body also carries `reason: "not-signed-in"`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '403': {
            description:
              'A cross-site Origin was sent, or the caller was refused by identity or the invite gate.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '404': {
            description: "The project does not exist or is not the caller's.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '405': {
            description:
              'Method not allowed. The error text names the accepted methods (POST, DELETE).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '409': {
            description:
              'The link was turned off by an operator and cannot be turned on again, or the project is archived.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '413': {
            description:
              'The declared Content-Length is over the body limit for project writes, or the conversation is too long to save.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '415': {
            description:
              'The Content-Type header is not application/json. Checked on every POST and PATCH here, including ones that send no body.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Projects are not configured for this deployment (no D1 or R2 binding), or the account could not be checked right now.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
      delete: {
        operationId: 'disableProjectShare',
        summary:
          "Turn a project's share link off for good and stop any live preview it started.",
        description:
          'Not invite-gated, so an account whose access was revoked can still pull its link.',
        tags: ['Sharing'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        responses: {
          '200': {
            description: 'The project, with the link off.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ProjectEnvelope',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names. The body also carries `reason: "not-signed-in"`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '403': {
            description:
              'A cross-site Origin was sent, or the caller was refused by identity.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '404': {
            description: "The project does not exist or is not the caller's.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Projects are not configured for this deployment (no D1 or R2 binding), or the account could not be checked right now.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/publish': {
      post: {
        operationId: 'publishProject',
        summary:
          "Build the given project files and publish the result as the project's public site.",
        description:
          "Behind the invite gate. One site per project: `projectId` names which project's site; a request without one comes from an older builder and means the account's first project. Any method other than POST and DELETE is answered 405 by this operation.",
        tags: ['Publishing'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/PublishRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Published.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/PublishResult',
                },
              },
            },
          },
          '400': {
            description:
              'Body is not valid JSON, `files` is missing, empty or malformed, `slug` is not a non-empty string, `projectId` is malformed, a request without `projectId` from a stale page, or a 400 passed through from the publish service.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names (reason `not-signed-in`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '403': {
            description:
              'Refused before the handler runs: sign-in is not configured for this deployment (`not-configured`), the token failed verification (`not-signed-in`), the account is banned (`account-banned`) or scheduled for deletion (`deletion-scheduled`, with `purgeAfter`). Also the invite gate: a signed-in caller who has not been invited gets `accessRefused: true` and reason `access-refused`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '404': {
            description:
              "`projectId` names a project that is not the caller's.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '409': {
            description:
              'The project is archived, or the publish service reports a conflict (such as a slug in use).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '413': {
            description:
              'More than 50 files, a path over 256 characters, or too many path or content characters in total.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '422': {
            description: 'The project did not build.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '429': {
            description: 'Too many publish requests from this account.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '502': {
            description: 'The publish service failed or answered unreadably.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Publishing is not configured here (checked before identity), the build service is unavailable, or the account could not be checked for a ban or a pending deletion (the database did not answer).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
      delete: {
        operationId: 'unpublishProject',
        summary: "Take a project's published site off the web.",
        description:
          "Not behind the invite gate: a takedown is never refused for lack of an invite. The body is optional; without one, an older builder means the account's first project's site. Needs only the publish service, not the build service.",
        tags: ['Publishing'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/UnpublishRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Taken down.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/UnpublishResult',
                },
              },
            },
          },
          '400': {
            description:
              '`projectId` is malformed, or a 400 passed through from the publish service.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names (reason `not-signed-in`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '403': {
            description:
              'Refused before the handler runs: sign-in is not configured for this deployment (`not-configured`), the token failed verification (`not-signed-in`), the account is banned (`account-banned`) or scheduled for deletion (`deletion-scheduled`, with `purgeAfter`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '404': {
            description:
              "`projectId` names a project that is not the caller's, or the publish service has no such site for the caller.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '429': {
            description: 'Too many publish requests from this account.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '502': {
            description: 'The publish service failed or answered unreadably.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Publishing is not configured here, or the account could not be checked for a ban or a pending deletion (the database did not answer).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/referral/claim': {
      post: {
        operationId: 'claimReferral',
        summary: 'Record the referral code the caller arrived with.',
        description:
          'Invite-gated on every method. On this method the invite gate also applies: a signed-in caller who has not been invited gets 403 with `accessRefused: true` and `reason: "access-refused"`. Answers the same way whether or not the claim was recorded. The method is checked after identity and the gate. The Content-Type is not checked.',
        tags: ['Account'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        requestBody: {
          required: true,
          description:
            'Must be valid JSON. A missing or non-string `code` is accepted and recorded as nothing.',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ReferralClaimRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Always `{ "recorded": true }`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ReferralClaimResult',
                },
              },
            },
          },
          '400': {
            description: 'The body is not valid JSON.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names. The body also carries `reason: "not-signed-in"`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '403': {
            description:
              'Refused: the session token failed verification (`reason: "not-signed-in"`), the account is banned (`reason: "account-banned"`), the account is scheduled for deletion (`reason: "deletion-scheduled"`, with `purgeAfter`), or sign-in is not configured on this deployment (`reason: "not-configured"`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '405': {
            description:
              'Method not allowed. The error text names the accepted methods (POST).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Referrals are not configured here, or the account could not be checked.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/referral/status': {
      get: {
        operationId: 'getReferralStatus',
        summary:
          "Get the caller's referral code and link, issuing a code on first request, with referral counts and earnings.",
        description:
          'Invite-gated on every method. On this method the invite gate also applies: a signed-in caller who has not been invited gets 403 with `accessRefused: true` and `reason: "access-refused"`. The method is checked after identity and the gate.',
        tags: ['Account'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        responses: {
          '200': {
            description: "The caller's referral status.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ReferralStatus',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names. The body also carries `reason: "not-signed-in"`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '403': {
            description:
              'Refused: the session token failed verification (`reason: "not-signed-in"`), the account is banned (`reason: "account-banned"`), the account is scheduled for deletion (`reason: "deletion-scheduled"`, with `purgeAfter`), or sign-in is not configured on this deployment (`reason: "not-configured"`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '405': {
            description:
              'Method not allowed. The error text names the accepted methods (GET).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Referrals are not configured here, or the account could not be checked.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/runs': {
      get: {
        operationId: 'listRuns',
        summary: "List one project's finished builds, newest first.",
        description:
          "Not behind the invite gate: a revoked account can still read its own run history. At most 20 runs. Without `project`, reads the caller's most recently opened project, and an account with no project gets an empty list. An archived project's history can be read.",
        tags: ['Building'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [
          {
            name: 'project',
            in: 'query',
            required: false,
            description: 'The project id (`^[A-Za-z0-9_-]{1,128}$`).',
            schema: {
              type: 'string',
              pattern: '^[A-Za-z0-9_-]{1,128}$',
            },
          },
        ],
        responses: {
          '200': {
            description: "The project's run traces.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RunHistory',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names (reason `not-signed-in`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '403': {
            description:
              'Refused before the handler runs: sign-in is not configured for this deployment (`not-configured`), the token failed verification (`not-signed-in`), the account is banned (`account-banned`) or scheduled for deletion (`deletion-scheduled`, with `purgeAfter`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '404': {
            description:
              "`project` is malformed or not one of the caller's projects.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '405': {
            description: 'Method other than GET (checked before identity).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Run history is not configured here or the database did not answer, or the account could not be checked for a ban or a pending deletion (the database did not answer).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/runs/{id}': {
      get: {
        operationId: 'getRun',
        summary: "Ask what became of one of the caller's builds.",
        description:
          "Not behind the invite gate. For a running build being checked, `snapshot` carries the promoted revision's code unless `known` already names it. For an accepted build, `snapshot` carries the accepted code when it is still the project's accepted revision.",
        tags: ['Building'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description:
              "The run id (the Workflow instance id the build stream's `run` event carries). Must match `^[A-Za-z0-9_-]{1,128}$`.",
            schema: {
              type: 'string',
              pattern: '^[A-Za-z0-9_-]{1,128}$',
            },
          },
          {
            name: 'known',
            in: 'query',
            required: false,
            description:
              'The revision the builder already has; the checking snapshot is not sent again when it matches.',
            schema: {
              type: 'string',
            },
          },
        ],
        responses: {
          '200': {
            description: 'The run, and its code where relevant.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RunResponse',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names (reason `not-signed-in`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '403': {
            description:
              'Refused before the handler runs: sign-in is not configured for this deployment (`not-configured`), the token failed verification (`not-signed-in`), the account is banned (`account-banned`) or scheduled for deletion (`deletion-scheduled`, with `purgeAfter`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '404': {
            description:
              "The id is malformed or names no build of the caller's.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '405': {
            description: 'Method other than GET or DELETE.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Builds are not configured here (checked before the method), or the account could not be checked for a ban or a pending deletion (the database did not answer).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
      delete: {
        operationId: 'stopRun',
        summary: "Stop one of the caller's builds.",
        description:
          'Not behind the invite gate: an account can always stop its own build. Idempotent: a build that already ended is answered with how it ended. Origin and a per-address limit are checked before identity.',
        tags: ['Building'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description:
              "The run id (the Workflow instance id the build stream's `run` event carries). Must match `^[A-Za-z0-9_-]{1,128}$`.",
            schema: {
              type: 'string',
              pattern: '^[A-Za-z0-9_-]{1,128}$',
            },
          },
        ],
        responses: {
          '200': {
            description: 'The run after the stop.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RunStopResponse',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names (reason `not-signed-in`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '403': {
            description:
              'Cross-site Origin (plain error, before identity), or an identity refusal.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '404': {
            description:
              "The id is malformed or names no build of the caller's.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '405': {
            description: 'Method other than GET or DELETE.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '429': {
            description: 'Too many requests from this address.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Builds are not configured here, the build could not be stopped and is still running, or the account could not be checked for a ban or a pending deletion (the database did not answer).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/share/{token}': {
      parameters: [
        {
          name: 'token',
          in: 'path',
          required: true,
          description:
            'The share token: 32 random bytes in unpadded base64url. A token of the wrong shape is answered 404 like any inactive link.',
          schema: {
            type: 'string',
            pattern: '^[A-Za-z0-9_-]{43}$',
          },
        },
      ],
      get: {
        operationId: 'getSharedProject',
        summary:
          "Read a shared project's name and accepted code by its share token, without signing in.",
        description:
          'The token is the grant. Responses carry `Cache-Control: no-store`. Requests are rate limited per client address.',
        tags: ['Sharing'],
        security: [],
        parameters: [],
        responses: {
          '200': {
            description: 'The shared project.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/SharedProject',
                },
              },
            },
          },
          '404': {
            description:
              'The link is not active: off, held, archived, deleted, its owner suspended or leaving, or a token that never existed. All give the same answer.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '405': {
            description:
              'Method not allowed. The error text names the accepted methods (GET).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '429': {
            description: 'Too many requests from this address.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description: 'Sharing is not configured for this deployment.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/share/{token}/preview': {
      parameters: [
        {
          name: 'token',
          in: 'path',
          required: true,
          description:
            'The share token: 32 random bytes in unpadded base64url. A token of the wrong shape is answered 404 like any inactive link.',
          schema: {
            type: 'string',
            pattern: '^[A-Za-z0-9_-]{43}$',
          },
        },
      ],
      get: {
        operationId: 'getSharedProjectPreview',
        summary:
          "Read the state of a shared project's live preview, without signing in.",
        description:
          'One sandbox serves every viewer of a link. Requests are rate limited per client address. Responses carry `Cache-Control: no-store`.',
        tags: ['Sharing'],
        security: [],
        parameters: [],
        responses: {
          '200': {
            description: "The preview's state.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/PreviewStatus',
                },
              },
            },
          },
          '404': {
            description: 'The link is not active.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '405': {
            description:
              'Method not allowed. The error text names the accepted methods (GET, POST).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '429': {
            description: 'Too many requests from this address.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '502': {
            description: 'The preview service returned an unreadable response.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Sharing or live previews are not available on this deployment.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'startSharedProjectPreview',
        summary: "Start a shared project's live preview as a signed-in caller.",
        description:
          'Needs an account but not an invite. Rate limited per client address and per account. The order of checks is: origin and content type, address limit, token, link, preview service, identity, suspension, account limit, accepted code.',
        tags: ['Sharing'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        requestBody: {
          required: true,
          description:
            'Send `{}`. The body is not read, but the request must carry `Content-Type: application/json` or it is refused with 415.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
              },
            },
          },
        },
        responses: {
          '200': {
            description: "The preview's state after starting.",
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/PreviewStatus',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names. The body also carries `reason: "not-signed-in"`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '403': {
            description:
              'A cross-site Origin was sent, the caller\'s account is suspended (`reason: "account-suspended"`), or the caller was refused by identity. Refused: the session token failed verification (`reason: "not-signed-in"`), the account is banned (`reason: "account-banned"`), the account is scheduled for deletion (`reason: "deletion-scheduled"`, with `purgeAfter`), or sign-in is not configured on this deployment (`reason: "not-configured"`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '404': {
            description: 'The link is not active.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '409': {
            description: 'The project has no accepted code to preview yet.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '415': {
            description:
              'The Content-Type header is not application/json. Checked on every POST and PATCH here, including ones that send no body.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '429': {
            description:
              'Too many requests from this address, or too many live previews started by this account.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Sharing or live previews are not available on this deployment, or the account could not be checked.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/share/{token}/remix': {
      parameters: [
        {
          name: 'token',
          in: 'path',
          required: true,
          description:
            'The share token: 32 random bytes in unpadded base64url. A token of the wrong shape is answered 404 like any inactive link.',
          schema: {
            type: 'string',
            pattern: '^[A-Za-z0-9_-]{43}$',
          },
        },
      ],
      post: {
        operationId: 'remixSharedProject',
        summary:
          "Copy a shared project's accepted code and settings, not its conversation, into a new project of the caller's.",
        description:
          'Invite-gated on every method. On this method the invite gate also applies: a signed-in caller who has not been invited gets 403 with `accessRefused: true` and `reason: "access-refused"`. Media the code uses is copied into the caller\'s library when the project is another account\'s. Held to the active project limit and rate limited per account.',
        tags: ['Sharing'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [],
        requestBody: {
          required: true,
          description:
            'Send `{}`. The body is not read, but the request must carry `Content-Type: application/json` or it is refused with 415.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'The new project.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ProjectEnvelope',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names. The body also carries `reason: "not-signed-in"`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '403': {
            description:
              'The active project limit is reached (`code: "project-limit"`), a cross-site Origin was sent, or the caller was refused by identity or the invite gate.',
            content: {
              'application/json': {
                schema: {
                  anyOf: [
                    {
                      $ref: '#/components/schemas/ProjectLimitError',
                    },
                    {
                      $ref: '#/components/schemas/Error',
                    },
                  ],
                },
              },
            },
          },
          '404': {
            description: 'The link is not active.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '405': {
            description:
              'Method not allowed. The error text names the accepted methods (POST).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '409': {
            description:
              'There is not enough room in the caller\'s media library for the copied media (`code: "media-room"`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '415': {
            description:
              'The Content-Type header is not application/json. Checked on every POST and PATCH here, including ones that send no body.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '429': {
            description: 'Too many remixes by this account.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'Sharing is not configured for this deployment, or the account could not be checked.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/style-gallery': {
      get: {
        operationId: 'getStyleGallery',
        summary:
          "List the style gallery's picker cards, or one style's colors and contrast pairs.",
        description:
          "Behind the invite gate. Without `style`, the body is an array of cards (empty where the gallery assets are not present). With `style`, it is that style's colors and contrast checks. Sent with `cache-control: private, max-age=3600` and `vary: Authorization`.",
        tags: ['Building'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [
          {
            name: 'style',
            in: 'query',
            required: false,
            description:
              'A gallery style id: kebab-case, at most 64 characters.',
            schema: {
              type: 'string',
              maxLength: 64,
            },
          },
        ],
        responses: {
          '200': {
            description: "The cards, or one style's color subject.",
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    {
                      type: 'array',
                      items: {
                        $ref: '#/components/schemas/StyleCard',
                      },
                    },
                    {
                      $ref: '#/components/schemas/StyleColorSubject',
                    },
                  ],
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names (reason `not-signed-in`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '403': {
            description:
              'Refused before the handler runs: sign-in is not configured for this deployment (`not-configured`), the token failed verification (`not-signed-in`), the account is banned (`account-banned`) or scheduled for deletion (`deletion-scheduled`, with `purgeAfter`). Also the invite gate: a signed-in caller who has not been invited gets `accessRefused: true` and reason `access-refused`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '404': {
            description:
              '`style` is not a gallery id, or the gallery has no such style.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '405': {
            description:
              'Method other than GET (answered after the invite gate).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'The account could not be checked for a ban or a pending deletion (the database did not answer).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/templates/brief': {
      get: {
        operationId: 'getTemplateBrief',
        summary: "Get one design template's brief for the builder.",
        description:
          'Behind the invite gate. Sent with `cache-control: private, max-age=3600` and `vary: Authorization`.',
        tags: ['Building'],
        security: [
          {
            clerk: [],
          },
        ],
        parameters: [
          {
            name: 'id',
            in: 'query',
            required: true,
            description:
              'Template id: lowercase letters, digits and hyphens, 1 to 80 characters.',
            schema: {
              type: 'string',
              pattern: '^[a-z0-9-]{1,80}$',
            },
          },
        ],
        responses: {
          '200': {
            description: 'The brief.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/TemplateBrief',
                },
              },
            },
          },
          '401': {
            description:
              'No usable identity: the request carries none of the sign-in its `security` names (reason `not-signed-in`).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '403': {
            description:
              'Refused before the handler runs: sign-in is not configured for this deployment (`not-configured`), the token failed verification (`not-signed-in`), the account is banned (`account-banned`) or scheduled for deletion (`deletion-scheduled`, with `purgeAfter`). Also the invite gate: a signed-in caller who has not been invited gets `accessRefused: true` and reason `access-refused`.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RefusalError',
                },
              },
            },
          },
          '404': {
            description: '`id` is malformed or names no template.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '405': {
            description:
              'Method other than GET (answered after the invite gate).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '503': {
            description:
              'The account could not be checked for a ban or a pending deletion (the database did not answer).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      clerk: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'A Clerk session token for a person signed in at app.vibld.com, issued by https://clerk.vibld.com and verified against its JWKS.',
      },
    },
    schemas: {
      AccessStatus: {
        type: 'object',
        required: ['allowed', 'mode', 'message'],
        properties: {
          allowed: {
            type: 'boolean',
            description: 'Whether the caller is admitted.',
          },
          mode: {
            type: 'string',
            enum: ['invite', 'open'],
          },
          message: {
            type: ['string', 'null'],
            description:
              'The refusal sentence when not allowed; null when allowed.',
          },
        },
      },
      AccountDeletionCancelResult: {
        oneOf: [
          {
            type: 'object',
            required: ['cancelled'],
            properties: {
              cancelled: {
                const: true,
              },
            },
          },
          {
            type: 'object',
            required: ['cancelled', 'scheduled'],
            properties: {
              cancelled: {
                const: false,
              },
              scheduled: {
                const: false,
              },
            },
            description: 'There was no standing request to cancel.',
          },
        ],
      },
      AccountDeletionRequest: {
        type: 'object',
        required: ['confirm'],
        properties: {
          confirm: {
            type: 'string',
            description:
              'Must be "delete my account" (compared trimmed and case-insensitively).',
          },
        },
      },
      AccountDeletionStatus: {
        oneOf: [
          {
            type: 'object',
            required: ['scheduled'],
            properties: {
              scheduled: {
                const: false,
              },
            },
          },
          {
            type: 'object',
            required: [
              'scheduled',
              'requestedAt',
              'purgeAfter',
              'steps',
              'errors',
              'cancellable',
            ],
            properties: {
              scheduled: {
                const: true,
              },
              requestedAt: {
                type: 'string',
                format: 'date-time',
              },
              purgeAfter: {
                type: 'string',
                format: 'date-time',
              },
              steps: {
                type: 'object',
                description: 'Whether each immediate step is done.',
                required: [
                  'subscription',
                  'preview',
                  'sites',
                  'github',
                  'referrals',
                ],
                properties: {
                  subscription: {
                    type: 'boolean',
                  },
                  preview: {
                    type: 'boolean',
                  },
                  sites: {
                    type: 'boolean',
                  },
                  github: {
                    type: 'boolean',
                  },
                  referrals: {
                    type: 'boolean',
                  },
                },
              },
              errors: {
                type: 'array',
                items: {
                  type: 'string',
                },
              },
              cancellable: {
                type: 'boolean',
                description: 'True while the purge has not started.',
              },
            },
          },
        ],
      },
      AuthRefusal: {
        description:
          'An authentication or access refusal. Every field beyond `error` is optional because the refusals differ.',
        allOf: [
          {
            $ref: '#/components/schemas/Error',
          },
          {
            type: 'object',
            properties: {
              reason: {
                type: 'string',
                enum: [
                  'not-signed-in',
                  'not-configured',
                  'account-banned',
                  'deletion-scheduled',
                  'access-refused',
                ],
              },
              accessRefused: {
                type: 'boolean',
                const: true,
                description: 'Present on an invite-gate refusal.',
              },
              purgeAfter: {
                type: 'string',
                description:
                  'When a scheduled deletion happens. Present with `reason: "deletion-scheduled"`.',
              },
            },
          },
        ],
      },
      AutoReloadOutcome: {
        type: 'string',
        enum: ['credited', 'off', 'skipped', 'capped', 'failed', 'pending'],
      },
      AutoReloadRequest: {
        type: 'object',
        required: ['enabled'],
        properties: {
          enabled: {
            type: 'boolean',
          },
          monthlyCapUsdCents: {
            type: 'integer',
            minimum: 1000,
            maximum: 10000,
            multipleOf: 1000,
            default: 3000,
            description:
              'The most auto-reload may charge in a month, in whole $10 top-ups.',
          },
        },
      },
      AutoReloadSettingsResponse: {
        type: 'object',
        required: ['enabled', 'monthlyCapUsdCents'],
        properties: {
          enabled: {
            type: 'boolean',
            description:
              'Read back from storage after saving when turning it on.',
          },
          monthlyCapUsdCents: {
            type: 'integer',
          },
          card: {
            $ref: '#/components/schemas/SavedCard',
            description:
              'The card it will charge. Present only when turning it on.',
          },
          reload: {
            $ref: '#/components/schemas/AutoReloadOutcome',
            description:
              'The outcome of the immediate reload check. Present only when turning it on and the check did not throw.',
          },
        },
      },
      AutoSubscribeRequest: {
        type: 'object',
        required: ['enabled'],
        properties: {
          enabled: {
            type: 'boolean',
          },
        },
      },
      AutoSubscribeSettingsResponse: {
        type: 'object',
        required: ['enabled'],
        properties: {
          enabled: {
            type: 'boolean',
          },
          card: {
            $ref: '#/components/schemas/SavedCard',
            description: 'Present only when turning it on.',
          },
          disabledReason: {
            oneOf: [
              {
                type: 'string',
                enum: [
                  'subscribed',
                  'declined',
                  'authentication_required',
                  'no_card',
                ],
              },
              {
                type: 'null',
              },
            ],
            description: 'Present only when turning it on.',
          },
        },
      },
      BillingConflict: {
        allOf: [
          {
            $ref: '#/components/schemas/Error',
          },
          {
            type: 'object',
            properties: {
              needsCard: {
                type: 'boolean',
                const: true,
              },
              alreadySubscribed: {
                type: 'boolean',
                const: true,
              },
              alreadyUsed: {
                type: 'boolean',
                const: true,
              },
              autoSubscribing: {
                type: 'boolean',
                const: true,
              },
            },
          },
        ],
      },
      BillingStatus: {
        type: 'object',
        required: [
          'tier',
          'allowanceMicroUsd',
          'spentMicroUsd',
          'topupRemainingMicroUsd',
          'currentPeriodEnd',
          'cancelAtPeriodEnd',
          'hasStripeCustomer',
          'billingConfigured',
          'signupCredit',
          'suspended',
          'autoReload',
          'autoSubscribe',
          'planTier',
          'gift',
        ],
        properties: {
          tier: {
            type: 'string',
            enum: ['free', 'build', 'ship'],
            description:
              'The effective tier, counting a gifted plan where it is higher.',
          },
          allowanceMicroUsd: {
            type: 'integer',
            description:
              'The allowance for the current period (or the free trial), in micro-USD.',
          },
          spentMicroUsd: {
            type: 'integer',
            description: 'Spend in the current allowance period, in micro-USD.',
          },
          topupRemainingMicroUsd: {
            type: 'integer',
            minimum: 0,
            description: 'Top-up and admin-granted credit left, in micro-USD.',
          },
          currentPeriodEnd: {
            oneOf: [
              {
                type: 'string',
              },
              {
                type: 'null',
              },
            ],
          },
          cancelAtPeriodEnd: {
            type: 'boolean',
          },
          hasStripeCustomer: {
            type: 'boolean',
            description: 'Whether the Billing Portal can be opened.',
          },
          billingConfigured: {
            type: 'boolean',
          },
          signupCredit: {
            $ref: '#/components/schemas/SignupCreditStatus',
          },
          freeTrial: {
            type: 'object',
            description:
              'Present only when a Free account is on the trial allowance instead of the monthly one.',
            required: ['cardAlreadyUsed', 'monthlyMicroUsd'],
            properties: {
              cardAlreadyUsed: {
                type: 'boolean',
              },
              monthlyMicroUsd: {
                type: 'integer',
                description:
                  'The monthly allowance a saved card would unlock, in micro-USD.',
              },
            },
          },
          suspended: {
            type: 'boolean',
          },
          autoReload: {
            type: 'object',
            required: [
              'enabled',
              'monthlyCapUsdCents',
              'card',
              'disabledReason',
              'reloadsThisMonth',
            ],
            properties: {
              enabled: {
                type: 'boolean',
              },
              monthlyCapUsdCents: {
                type: 'integer',
              },
              card: {
                oneOf: [
                  {
                    $ref: '#/components/schemas/SavedCard',
                  },
                  {
                    type: 'null',
                  },
                ],
              },
              disabledReason: {
                oneOf: [
                  {
                    type: 'string',
                    enum: ['declined', 'authentication_required', 'no_card'],
                  },
                  {
                    type: 'null',
                  },
                ],
              },
              reloadsThisMonth: {
                type: 'integer',
              },
            },
          },
          autoSubscribe: {
            type: 'object',
            required: [
              'enabled',
              'card',
              'disabledReason',
              'used',
              'buildMonthlyUsdCents',
            ],
            properties: {
              enabled: {
                type: 'boolean',
              },
              card: {
                oneOf: [
                  {
                    $ref: '#/components/schemas/SavedCard',
                  },
                  {
                    type: 'null',
                  },
                ],
              },
              disabledReason: {
                oneOf: [
                  {
                    type: 'string',
                    enum: [
                      'subscribed',
                      'declined',
                      'authentication_required',
                      'no_card',
                    ],
                  },
                  {
                    type: 'null',
                  },
                ],
              },
              used: {
                type: 'boolean',
                description:
                  'Auto-subscribe has already started a plan, which it does only once.',
              },
              buildMonthlyUsdCents: {
                type: 'integer',
                description: 'The Build monthly price it would start.',
              },
            },
          },
          planTier: {
            type: 'string',
            enum: ['free', 'build', 'ship'],
            description: 'The paid subscription alone, ignoring any gift.',
          },
          gift: {
            oneOf: [
              {
                type: 'object',
                required: ['tier', 'endsAt', 'inUse'],
                properties: {
                  tier: {
                    type: 'string',
                    enum: ['build', 'ship'],
                  },
                  endsAt: {
                    oneOf: [
                      {
                        type: 'string',
                      },
                      {
                        type: 'null',
                      },
                    ],
                  },
                  inUse: {
                    type: 'boolean',
                    description: 'Whether the gift is what decides `tier`.',
                  },
                },
              },
              {
                type: 'null',
              },
            ],
          },
        },
      },
      BuildEstimate: {
        type: 'object',
        required: ['microUsd', 'basis', 'draftMicroUsd'],
        properties: {
          microUsd: {
            type: 'integer',
            description:
              'Expected cost of a build on this model, in micro-USD.',
          },
          basis: {
            type: 'string',
            enum: ['history', 'ceiling'],
            description:
              '`history`: read from recent builds. `ceiling`: too few builds, so the most one can cost.',
          },
          draftMicroUsd: {
            type: 'integer',
            description:
              'The most the draft a first build draws can cost, in micro-USD.',
          },
        },
      },
      BuildPlanEvent: {
        type: 'object',
        description: "SSE `plan`: the build's result. Ends the stream.",
        required: ['providerId', 'plan', 'revision'],
        properties: {
          providerId: {
            type: 'string',
            description: 'The model the build ran on.',
          },
          plan: {
            type: 'object',
            required: ['summary', 'files'],
            properties: {
              summary: {
                type: 'string',
              },
              files: {
                type: 'array',
                items: {
                  $ref: '#/components/schemas/ProjectFile',
                },
              },
            },
          },
          revision: {
            type: 'string',
            description: 'The revision the project is now at.',
          },
          check: {
            type: 'string',
            enum: ['passed', 'failed', 'unchecked'],
            description: 'What the post-build check found, when known.',
          },
        },
      },
      BuildProgressEvent: {
        type: 'object',
        description:
          'SSE `progress`: about every 1.5 seconds while the run is going.',
        required: ['elapsedMs'],
        properties: {
          elapsedMs: {
            type: 'integer',
            description: 'Since the request arrived.',
          },
          stage: {
            type: 'string',
            enum: ['queued', 'running', 'thinking'],
          },
          characters: {
            type: 'integer',
            description:
              'Characters written so far; absent when unknown or zero.',
          },
          step: {
            type: 'string',
            description:
              'Which step of the build is running, at most 120 characters.',
            maxLength: 120,
          },
          phase: {
            type: 'string',
            enum: [
              'outline',
              'writing',
              'assembling',
              'validating',
              'repairing',
            ],
          },
          early: {
            type: 'object',
            description:
              'A promoted revision being checked, sent once per revision so the builder can show it before the check ends.',
            required: ['revision', 'files'],
            properties: {
              revision: {
                type: 'string',
              },
              files: {
                type: 'array',
                items: {
                  $ref: '#/components/schemas/ProjectFile',
                },
              },
            },
          },
        },
      },
      BuildRequest: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt: {
            type: 'string',
            description:
              'What to build or change. Non-blank, at most 40,000 characters.',
            maxLength: 40000,
          },
          base: {
            type: ['object', 'null'],
            description:
              'The revision a follow-up builds on. A legacy `files` member is accepted and ignored.',
            required: ['revision'],
            properties: {
              revision: {
                type: 'string',
                minLength: 1,
              },
            },
          },
          projectId: {
            type: ['string', 'null'],
            pattern: '^[A-Za-z0-9_-]{1,128}$',
            description:
              "Which project to build in. Without it, the caller's most recently opened project, or a new one.",
          },
          model: {
            type: ['string', 'null'],
            description:
              'A model id from the catalog (aliases resolved). Empty or absent means the default.',
          },
          style: {
            type: ['string', 'null'],
            description: 'A style preset id. Unknown ids are refused.',
          },
          styleDna: {
            type: ['object', 'null'],
            description:
              'Standing visual preferences, dimension id to option value. Unknown dimensions or values are dropped, not refused.',
            additionalProperties: {
              type: 'string',
            },
          },
          galleryStyle: {
            type: ['string', 'null'],
            maxLength: 64,
            description: 'A style gallery id (kebab-case).',
          },
          galleryColors: {
            oneOf: [
              {
                $ref: '#/components/schemas/GalleryColorEdits',
              },
              {
                type: 'null',
              },
            ],
          },
          knowledge: {
            type: ['string', 'null'],
            maxLength: 2000,
            description: 'Standing instructions for the project.',
          },
          referenceUrl: {
            type: ['string', 'null'],
            maxLength: 2048,
            description:
              'A page to copy from or emulate; fetched before anything is reserved. Empty string means none.',
          },
          mockup: {
            type: ['object', 'null'],
            description:
              'The direction picked from a mockup run, carried as the document.',
            required: ['label', 'html'],
            properties: {
              label: {
                type: 'string',
                description: 'Non-blank, at most 60 characters.',
                maxLength: 60,
              },
              html: {
                type: 'string',
                description: 'Non-blank, at most 24,000 characters.',
                maxLength: 24000,
              },
            },
          },
        },
      },
      BuildRunEvent: {
        type: 'object',
        description: 'SSE `run`: sent first, before any progress.',
        required: ['runId'],
        properties: {
          runId: {
            type: 'string',
            description:
              'The run id that `GET` and `DELETE /api/runs/{id}` take.',
          },
        },
      },
      BuilderConfig: {
        type: 'object',
        required: [
          'generation',
          'models',
          'defaultModel',
          'modelsNote',
          'isAdmin',
          'preview',
        ],
        properties: {
          generation: {
            type: 'string',
            enum: ['model', 'fake'],
            description: '`fake` when the deployment cannot generate.',
          },
          models: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/PickerModel',
            },
            description: 'Models this caller may use here.',
          },
          defaultModel: {
            type: ['string', 'null'],
            description:
              'The deployment default, only when this caller may use it.',
          },
          modelsNote: {
            type: ['string', 'null'],
            description:
              'Said where the picker would be when the plan keeps other models out.',
          },
          isAdmin: {
            type: 'boolean',
            description: 'Whether the caller is a platform admin.',
          },
          preview: {
            type: 'string',
            enum: ['sandbox', 'browser'],
            description: 'Where the preview pane runs a project.',
          },
        },
      },
      CardSetupRequest: {
        type: 'object',
        properties: {
          purpose: {
            type: 'string',
            enum: ['auto-reload'],
            description:
              'Saving a card for auto-reload; skips the "already has a card on file" refusal. Any other value is treated as absent.',
          },
        },
      },
      ChatMessage: {
        type: 'object',
        required: ['role', 'text'],
        properties: {
          role: {
            type: 'string',
            enum: ['user', 'assistant'],
          },
          text: {
            type: 'string',
            description: 'Non-blank, at most 40,000 characters.',
            maxLength: 40000,
          },
        },
      },
      ChatProviderFailure: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'string',
          },
          stop: {
            type: 'string',
            enum: [
              'applied',
              'no-changes',
              'cancelled',
              'validation-failed',
              'model-refused',
              'model-truncated',
              'model-shape',
              'context-exceeded',
              'run-budget-exceeded',
              'provider-error',
              'awaiting-answer',
              'retained',
              'conflict',
              'store-unavailable',
              'not-started',
            ],
          },
        },
      },
      ChatRequest: {
        type: 'object',
        required: ['messages'],
        properties: {
          messages: {
            type: 'array',
            minItems: 1,
            items: {
              $ref: '#/components/schemas/ChatMessage',
            },
            description:
              "Oldest first, ending with the user's message. Only the last 24 are kept; their text totals at most 60,000 characters.",
          },
          project: {
            type: ['object', 'null'],
            description:
              'The current accepted checkpoint, or null before the first build.',
            required: ['files'],
            properties: {
              summary: {
                type: ['string', 'null'],
                maxLength: 1000,
              },
              files: {
                type: 'array',
                maxItems: 100,
                items: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 256,
                },
                description:
                  'Paths only, no control characters, at most 8,000 characters in total.',
              },
            },
          },
          model: {
            type: ['string', 'null'],
          },
        },
      },
      ChatResponse: {
        type: 'object',
        required: ['turn', 'model'],
        properties: {
          turn: {
            $ref: '#/components/schemas/ChatTurn',
          },
          model: {
            type: 'string',
            description: 'The model that answered.',
          },
        },
      },
      ChatTurn: {
        oneOf: [
          {
            type: 'object',
            required: ['action', 'message'],
            properties: {
              action: {
                type: 'string',
                const: 'reply',
              },
              message: {
                type: 'string',
                maxLength: 2000,
              },
            },
          },
          {
            type: 'object',
            required: ['action', 'message', 'brief'],
            properties: {
              action: {
                type: 'string',
                const: 'build',
              },
              message: {
                type: 'string',
                description: 'What is about to happen.',
                maxLength: 2000,
              },
              brief: {
                type: 'string',
                description:
                  'The complete instruction to send as `prompt` to `POST /api/plan`.',
                maxLength: 4000,
              },
            },
          },
        ],
      },
      CheckoutRequest: {
        type: 'object',
        description:
          'Either a top-up (`topup: true`) or a subscription (`tier` and `interval`).',
        properties: {
          topup: {
            type: 'boolean',
            description:
              'When `true`, buys a top-up and the other fields are ignored.',
          },
          tier: {
            type: 'string',
            enum: ['build', 'ship'],
          },
          interval: {
            type: 'string',
            enum: ['monthly', 'annual'],
          },
        },
        anyOf: [
          {
            required: ['topup'],
            properties: {
              topup: {
                const: true,
              },
            },
          },
          {
            required: ['tier', 'interval'],
          },
        ],
      },
      Checkpoint: {
        type: 'object',
        required: ['revision', 'runId', 'kind', 'acceptedAt'],
        properties: {
          revision: {
            type: 'string',
          },
          runId: {
            oneOf: [
              {
                type: 'string',
              },
              {
                type: 'null',
              },
            ],
          },
          kind: {
            type: 'string',
            enum: ['build', 'repair', 'restore', 'rollback', 'copy'],
          },
          acceptedAt: {
            type: 'string',
            format: 'date-time',
          },
        },
      },
      CheckpointHistory: {
        type: 'object',
        required: ['current', 'checkpoints'],
        properties: {
          current: {
            oneOf: [
              {
                type: 'string',
                description:
                  'The accepted revision now; null for a project never built in.',
              },
              {
                type: 'null',
              },
            ],
          },
          checkpoints: {
            type: 'array',
            maxItems: 100,
            description: 'Newest first.',
            items: {
              $ref: '#/components/schemas/Checkpoint',
            },
          },
        },
      },
      CheckpointMovedError: {
        allOf: [
          {
            $ref: '#/components/schemas/Error',
          },
          {
            type: 'object',
            required: ['code', 'current'],
            properties: {
              code: {
                type: 'string',
                const: 'checkpoint-moved',
              },
              current: {
                oneOf: [
                  {
                    type: 'string',
                    description: 'The accepted revision now.',
                  },
                  {
                    type: 'null',
                  },
                ],
              },
            },
          },
        ],
      },
      CheckpointRestoreRequest: {
        type: 'object',
        required: ['revision', 'base'],
        properties: {
          revision: {
            type: 'string',
            pattern: '^[A-Za-z0-9_-]{1,64}$',
            description: 'The checkpoint to restore.',
          },
          base: {
            oneOf: [
              {
                type: 'string',
                pattern: '^[A-Za-z0-9_-]{1,64}$',
                description:
                  'The accepted revision the caller was looking at; null for none.',
              },
              {
                type: 'null',
              },
            ],
          },
        },
      },
      ConnectableRepository: {
        type: 'object',
        required: ['owner', 'repo', 'defaultBranch', 'installationId'],
        properties: {
          owner: {
            type: 'string',
          },
          repo: {
            type: 'string',
          },
          defaultBranch: {
            type: 'string',
          },
          installationId: {
            type: 'integer',
          },
        },
      },
      Error: {
        type: 'object',
        description:
          'Every refusal. `error` is a sentence for a person and may change; where a refusal has a stable name a script can branch on, it is in `reason` or `code`, and some refusals add fields of their own.',
        required: ['error'],
        properties: {
          error: {
            type: 'string',
          },
          reason: {
            type: 'string',
            description: 'A stable name for the refusal, when it has one.',
          },
        },
        additionalProperties: true,
      },
      GalleryColorEdits: {
        type: 'object',
        description:
          'Edited colors by token, at most 24 entries. Keys match `^--color-[a-z0-9-]{1,40}$`; values are 6-digit hexes.',
        maxProperties: 24,
        propertyNames: {
          pattern: '^--color-[a-z0-9-]{1,40}$',
        },
        additionalProperties: {
          type: 'string',
          pattern: '^#[0-9a-f]{6}$',
        },
      },
      GitHubBindRequest: {
        type: 'object',
        required: ['projectId', 'ticket', 'owner', 'repo'],
        properties: {
          projectId: {
            $ref: '#/components/schemas/ProjectId',
          },
          ticket: {
            type: 'string',
          },
          owner: {
            type: 'string',
          },
          repo: {
            type: 'string',
          },
        },
      },
      GitHubBinding: {
        type: 'object',
        required: ['projectId', 'owner', 'repo', 'defaultBranch', 'expiresAt'],
        properties: {
          projectId: {
            type: 'string',
          },
          owner: {
            type: 'string',
          },
          repo: {
            type: 'string',
          },
          defaultBranch: {
            type: 'string',
          },
          expiresAt: {
            type: 'string',
            format: 'date-time',
          },
        },
      },
      GitHubCompleteRequest: {
        type: 'object',
        required: ['code', 'state'],
        properties: {
          code: {
            type: 'string',
            minLength: 1,
          },
          state: {
            type: 'string',
            minLength: 1,
          },
          installation: {
            type: ['string', 'integer'],
            description:
              'The `installation_id` GitHub returned with, if any. Read with `Number()`; ignored unless a positive integer.',
          },
          create: {
            type: 'object',
            description:
              "Create a repository on the caller's own account. Ignored unless `name` is a string.",
            required: ['name'],
            properties: {
              name: {
                type: 'string',
              },
              private: {
                type: 'boolean',
                default: true,
              },
            },
          },
        },
      },
      GitHubCompleteResponse: {
        type: 'object',
        required: ['installations', 'repositories', 'ticket'],
        properties: {
          installations: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/UserInstallation',
            },
          },
          repositories: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/ConnectableRepository',
            },
            description: 'Sorted by `owner/repo`.',
          },
          login: {
            type: 'string',
          },
          created: {
            $ref: '#/components/schemas/ConnectableRepository',
          },
          createProblem: {
            type: 'object',
            required: ['error'],
            properties: {
              error: {
                type: 'string',
              },
              suggestion: {
                type: 'string',
              },
              install: {
                type: 'boolean',
              },
            },
          },
          omitted: {
            type: 'array',
            items: {
              type: 'string',
            },
            description:
              'Accounts whose installations were not read. Present only when non-empty.',
          },
          truncated: {
            type: 'boolean',
            const: true,
            description:
              'Present when some list was cut short by a page bound.',
          },
          ticket: {
            type: 'string',
            description:
              'Signed list of the offered repositories, for `/api/github/bind`.',
          },
        },
      },
      GitHubConnectStart: {
        type: 'object',
        required: ['url', 'state', 'installUrl'],
        properties: {
          url: {
            type: 'string',
            format: 'uri',
            description: 'GitHub authorization URL.',
          },
          state: {
            type: 'string',
            description:
              'Signed state to keep and pass to `/api/github/complete`.',
          },
          installUrl: {
            oneOf: [
              {
                type: 'string',
                format: 'uri',
                description: "This deployment's GitHub App installation URL.",
              },
              {
                type: 'null',
              },
            ],
          },
        },
      },
      GitHubDiffRequest: {
        type: 'object',
        required: ['projectId', 'files'],
        properties: {
          projectId: {
            $ref: '#/components/schemas/ProjectId',
          },
          files: {
            type: 'array',
            minItems: 1,
            maxItems: 50,
            items: {
              $ref: '#/components/schemas/ProjectFile',
            },
          },
        },
      },
      GitHubDiffResponse: {
        type: 'object',
        required: [
          'owner',
          'repo',
          'added',
          'changed',
          'removed',
          'unchanged',
          'baseBranch',
          'baseSha',
          'truncated',
        ],
        properties: {
          owner: {
            type: 'string',
          },
          repo: {
            type: 'string',
          },
          added: {
            type: 'array',
            items: {
              type: 'string',
            },
          },
          changed: {
            type: 'array',
            items: {
              type: 'string',
            },
          },
          removed: {
            type: 'array',
            items: {
              type: 'string',
            },
          },
          unchanged: {
            type: 'integer',
          },
          baseBranch: {
            type: 'string',
          },
          baseSha: {
            oneOf: [
              {
                type: 'string',
              },
              {
                type: 'null',
              },
            ],
          },
          truncated: {
            type: 'boolean',
            description:
              'GitHub did not list the whole base tree, so `removed` and `unchanged` are incomplete.',
          },
        },
      },
      GitHubDisconnectRequest: {
        type: 'object',
        required: ['projectId', 'owner', 'repo'],
        properties: {
          projectId: {
            $ref: '#/components/schemas/ProjectId',
          },
          owner: {
            type: 'string',
            minLength: 1,
            description:
              'The repository owner the caller expects is bound. Trimmed.',
          },
          repo: {
            type: 'string',
            minLength: 1,
            description:
              'The repository name the caller expects is bound. Trimmed.',
          },
        },
      },
      GitHubDisconnected: {
        type: 'object',
        required: ['connected'],
        properties: {
          connected: {
            type: 'boolean',
            const: false,
          },
        },
      },
      GitHubProblem: {
        allOf: [
          {
            $ref: '#/components/schemas/Error',
          },
          {
            type: 'object',
            properties: {
              reconnect: {
                type: 'boolean',
                const: true,
                description: 'Reconnecting GitHub is the fix.',
              },
              install: {
                type: 'boolean',
                const: true,
                description: 'Installing the GitHub App is the fix.',
              },
              conflict: {
                $ref: '#/components/schemas/PushConflict',
              },
              movedTo: {
                $ref: '#/components/schemas/RepositoryRef',
                description: 'The repository the project is bound to now.',
              },
            },
          },
        ],
      },
      GitHubPushRequest: {
        type: 'object',
        required: ['projectId', 'files', 'revision', 'owner', 'repo'],
        properties: {
          projectId: {
            $ref: '#/components/schemas/ProjectId',
          },
          files: {
            type: 'array',
            minItems: 1,
            maxItems: 50,
            items: {
              $ref: '#/components/schemas/ProjectFile',
            },
          },
          revision: {
            type: 'string',
            description:
              'The checkpoint id. After trimming: 1 to 64 of `A-Z a-z 0-9 . _ -`, not starting with a dot, not containing `..`, not ending in `.lock`.',
          },
          owner: {
            type: 'string',
            minLength: 1,
            description:
              'The repository owner the caller expects to push to. Trimmed.',
          },
          repo: {
            type: 'string',
            minLength: 1,
            description:
              'The repository name the caller expects to push to. Trimmed.',
          },
        },
      },
      GitHubPushResponse: {
        type: 'object',
        required: ['branch', 'commitSha', 'created'],
        properties: {
          branch: {
            type: 'string',
          },
          commitSha: {
            type: 'string',
          },
          created: {
            type: 'boolean',
            description: 'False when the branch already pointed at this tree.',
          },
          pullRequestUrl: {
            type: 'string',
            format: 'uri',
          },
          skippedMedia: {
            type: 'array',
            items: {
              type: 'string',
            },
            description:
              'Referenced media left out of the push. Present only when non-empty.',
          },
        },
      },
      GitHubStatus: {
        type: 'object',
        required: ['configured', 'canPush', 'canConnect'],
        properties: {
          configured: {
            type: 'boolean',
          },
          canPush: {
            type: 'boolean',
          },
          canConnect: {
            type: 'boolean',
          },
          account: {
            type: 'object',
            required: ['connected'],
            properties: {
              connected: {
                type: 'boolean',
              },
              login: {
                type: 'string',
              },
            },
          },
          projectId: {
            type: 'string',
          },
          connected: {
            type: 'boolean',
            description: 'Whether the project has a usable binding.',
          },
          reason: {
            type: 'string',
            enum: ['none', 'revoked', 'expired'],
            description: 'Present when `connected` is false.',
          },
          owner: {
            type: 'string',
          },
          repo: {
            type: 'string',
          },
          defaultBranch: {
            type: 'string',
          },
          expiresAt: {
            type: 'string',
          },
          pullRequest: {
            type: 'object',
            description:
              'The last pull request vibld opened for this project in the connected repository, if any.',
            required: ['url', 'branch', 'state'],
            properties: {
              url: {
                type: 'string',
                format: 'uri',
              },
              branch: {
                type: 'string',
              },
              state: {
                oneOf: [
                  {
                    type: 'string',
                    enum: ['open', 'closed', 'merged'],
                  },
                  {
                    type: 'null',
                  },
                ],
              },
            },
          },
        },
      },
      Health: {
        type: 'object',
        required: ['status'],
        properties: {
          status: {
            const: 'ok',
          },
        },
      },
      MediaEntry: {
        type: 'object',
        required: [
          'id',
          'path',
          'kind',
          'contentType',
          'bytes',
          'alt',
          'gitSha',
          'createdAt',
        ],
        properties: {
          id: {
            type: 'string',
          },
          path: {
            type: 'string',
            description:
              '`media/<slug>.<ext>`, served to built sites at `/media/<slug>.<ext>`.',
          },
          kind: {
            type: 'string',
            enum: ['image', 'video'],
          },
          contentType: {
            type: 'string',
          },
          bytes: {
            type: 'integer',
          },
          alt: {
            type: 'string',
          },
          posterPath: {
            type: 'string',
            description:
              "For a video, its poster image's path, when it has one.",
          },
          gitSha: {
            type: 'string',
            description: 'The git blob id of the bytes.',
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
          },
        },
      },
      MediaLibrary: {
        type: 'object',
        required: ['media', 'usage'],
        properties: {
          media: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/MediaEntry',
            },
          },
          usage: {
            type: 'object',
            required: ['files', 'bytes', 'maxBytes', 'maxFiles'],
            properties: {
              files: {
                type: 'integer',
              },
              bytes: {
                type: 'integer',
              },
              maxBytes: {
                type: 'integer',
              },
              maxFiles: {
                type: 'integer',
              },
            },
          },
        },
      },
      MediaRemoved: {
        type: 'object',
        required: ['removed'],
        properties: {
          removed: {
            type: 'string',
            description: 'The id that was removed.',
          },
        },
      },
      MediaUploaded: {
        type: 'object',
        required: ['media'],
        properties: {
          media: {
            $ref: '#/components/schemas/MediaEntry',
          },
        },
      },
      Mockup: {
        type: 'object',
        required: ['label', 'rationale', 'html'],
        properties: {
          label: {
            type: 'string',
            description:
              'Two or three words naming the direction, at most 60 characters.',
            maxLength: 60,
          },
          rationale: {
            type: 'string',
            description:
              'One sentence on who the direction suits, at most 400 characters.',
            maxLength: 400,
          },
          html: {
            type: 'string',
            description:
              'One self-contained HTML document, at most 24,000 characters.',
            maxLength: 24000,
          },
        },
      },
      MockupProgressEvent: {
        type: 'object',
        description:
          'SSE `progress`: streamed character count while the model writes.',
        required: ['characters', 'elapsedMs', 'stage'],
        properties: {
          characters: {
            type: 'integer',
          },
          elapsedMs: {
            type: 'integer',
          },
          stage: {
            type: 'string',
            const: 'running',
          },
        },
      },
      MockupRequest: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt: {
            type: 'string',
            description: 'Non-blank, at most 40,000 characters.',
            maxLength: 40000,
          },
          draft: {
            type: 'boolean',
            description:
              'One direction to show while a build runs, rather than several to choose between. Must be a boolean if present.',
          },
          model: {
            type: ['string', 'null'],
          },
          style: {
            type: ['string', 'null'],
            description: 'A style preset id.',
          },
          galleryStyle: {
            type: ['string', 'null'],
            maxLength: 64,
          },
          galleryColors: {
            oneOf: [
              {
                $ref: '#/components/schemas/GalleryColorEdits',
              },
              {
                type: 'null',
              },
            ],
          },
        },
      },
      MockupsEvent: {
        type: 'object',
        description: 'SSE `mockups`: the result. Ends the stream.',
        required: ['providerId', 'mockups'],
        properties: {
          providerId: {
            type: 'string',
            description: 'The model that drew them.',
          },
          mockups: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/Mockup',
            },
            minItems: 1,
            maxItems: 4,
            description: 'Two to four directions, or one to four for a draft.',
          },
        },
      },
      OkResult: {
        type: 'object',
        required: ['ok'],
        properties: {
          ok: {
            type: 'boolean',
            const: true,
          },
        },
      },
      OwnerSessionRequest: {
        type: 'object',
        required: ['password'],
        properties: {
          password: {
            type: 'string',
            description: 'The owner password.',
            minLength: 1,
          },
        },
      },
      OwnerSessionState: {
        type: 'object',
        required: ['signedIn'],
        properties: {
          signedIn: {
            type: 'boolean',
          },
        },
      },
      PickerModel: {
        type: 'object',
        required: ['id', 'label', 'note', 'provider', 'buildEstimate'],
        properties: {
          id: {
            type: 'string',
            description: 'Model id.',
          },
          label: {
            type: 'string',
            description: 'Shown in the picker.',
          },
          note: {
            type: 'string',
            description: 'One short line under the label.',
          },
          provider: {
            type: 'string',
            enum: ['anthropic', 'deepseek', 'openai', 'local'],
          },
          buildEstimate: {
            oneOf: [
              {
                $ref: '#/components/schemas/BuildEstimate',
              },
              {
                type: 'null',
              },
            ],
            description: 'Null when the estimate could not be read.',
          },
        },
      },
      PreviewShare: {
        type: 'object',
        required: ['shareId', 'createdAt', 'expiresAt', 'revoked'],
        properties: {
          shareId: {
            type: 'string',
          },
          createdAt: {
            type: 'number',
          },
          expiresAt: {
            type: 'number',
          },
          revoked: {
            type: 'boolean',
          },
          url: {
            type: 'string',
            description: 'Present only for a link that still works.',
          },
        },
      },
      PreviewShareCreated: {
        type: 'object',
        required: ['shareId', 'expiresAt', 'url'],
        properties: {
          shareId: {
            type: 'string',
          },
          expiresAt: {
            type: 'number',
          },
          url: {
            type: 'string',
          },
        },
      },
      PreviewShareList: {
        type: 'object',
        required: ['shares'],
        properties: {
          shares: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/PreviewShare',
            },
          },
        },
      },
      PreviewShareRevokeRequest: {
        type: 'object',
        required: ['shareId'],
        properties: {
          shareId: {
            type: 'string',
            minLength: 1,
          },
        },
      },
      PreviewStartRequest: {
        type: 'object',
        required: ['files'],
        properties: {
          files: {
            type: 'array',
            minItems: 1,
            maxItems: 50,
            items: {
              $ref: '#/components/schemas/StagedFile',
            },
          },
          revision: {
            type: 'string',
            description: 'The checkpoint these files are, 1 to 200 characters.',
            minLength: 1,
            maxLength: 200,
          },
        },
      },
      PreviewStatus: {
        type: 'object',
        required: ['status'],
        properties: {
          status: {
            type: 'string',
            enum: [
              'queued',
              'ready-to-start',
              'installing',
              'starting',
              'ready',
              'failed',
            ],
          },
          position: {
            type: 'integer',
            description: 'Queue position, for `queued`.',
          },
          url: {
            type: 'string',
            description: 'The preview URL, for `ready`.',
          },
          expiresAt: {
            type: 'number',
            description:
              'When the preview expires, for `ready` (as the preview service reports it).',
          },
          typecheckFailure: {
            type: 'string',
            description: 'For `ready`, when the project failed its type check.',
          },
          revision: {
            type: 'string',
            description:
              'For `ready`, the revision served; for `installing` and `starting`, the one being started, or the one still served while a live update installs `updatingTo`. When known.',
          },
          updatingTo: {
            type: 'string',
            description:
              'For `installing`, the revision a live update is installing while `revision` is still served (D74).',
          },
          error: {
            type: 'string',
            description: 'For `failed`.',
          },
        },
      },
      PreviewUpdate: {
        type: 'object',
        required: ['outcome'],
        properties: {
          outcome: {
            type: 'string',
            enum: ['applied', 'installing', 'busy', 'restart'],
          },
          status: {
            allOf: [
              {
                $ref: '#/components/schemas/PreviewStatus',
              },
            ],
            description: 'For `applied`: always a `ready` status.',
          },
          reason: {
            type: 'string',
            description: 'For `restart`.',
          },
        },
      },
      PreviewUpdateRequest: {
        type: 'object',
        required: ['files', 'revision'],
        properties: {
          files: {
            type: 'array',
            minItems: 1,
            maxItems: 50,
            items: {
              $ref: '#/components/schemas/StagedFile',
            },
          },
          revision: {
            type: 'string',
            description: 'The checkpoint these files are, 1 to 200 characters.',
            minLength: 1,
            maxLength: 200,
          },
        },
      },
      Project: {
        type: 'object',
        description: "A project as its owner's builder reads it.",
        required: [
          'id',
          'name',
          'archived',
          'archivedAt',
          'createdAt',
          'editedAt',
          'lastOpenedAt',
          'hasCode',
          'turns',
          'version',
          'settings',
          'share',
          'site',
        ],
        properties: {
          id: {
            type: 'string',
          },
          name: {
            type: 'string',
            maxLength: 120,
          },
          archived: {
            type: 'boolean',
          },
          archivedAt: {
            oneOf: [
              {
                type: 'string',
                format: 'date-time',
              },
              {
                type: 'null',
              },
            ],
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
          },
          editedAt: {
            type: 'string',
            format: 'date-time',
          },
          lastOpenedAt: {
            type: 'string',
            format: 'date-time',
          },
          hasCode: {
            type: 'boolean',
            description: 'Whether a build has been accepted.',
          },
          turns: {
            type: 'integer',
            description: 'Number of conversation turns stored.',
          },
          version: {
            type: 'integer',
            description:
              'The save version; the next save names it as the one it was made from.',
          },
          settings: {
            $ref: '#/components/schemas/ProjectSettings',
          },
          share: {
            $ref: '#/components/schemas/ProjectShareState',
          },
          site: {
            oneOf: [
              {
                $ref: '#/components/schemas/ProjectSite',
              },
              {
                type: 'null',
              },
            ],
          },
        },
      },
      ProjectChangedError: {
        allOf: [
          {
            $ref: '#/components/schemas/Error',
          },
          {
            type: 'object',
            required: ['code', 'version'],
            properties: {
              code: {
                type: 'string',
                const: 'project-changed',
              },
              version: {
                type: 'integer',
                description: "The project's current version.",
              },
            },
          },
        ],
      },
      ProjectCreateRequest: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description:
              'Cleaned (whitespace collapsed, control characters removed) and cut to 120 characters. Missing or blank gives "Untitled project".',
          },
          settings: {
            $ref: '#/components/schemas/ProjectSettingsInput',
          },
        },
      },
      ProjectDetail: {
        type: 'object',
        required: ['project', 'transcript', 'snapshot', 'build'],
        properties: {
          project: {
            $ref: '#/components/schemas/Project',
          },
          transcript: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/TranscriptTurn',
            },
          },
          snapshot: {
            oneOf: [
              {
                $ref: '#/components/schemas/ProjectSnapshot',
              },
              {
                type: 'null',
              },
            ],
          },
          build: {
            oneOf: [
              {
                type: 'object',
                description: 'A build still running in the project.',
                required: ['runId', 'startedAt'],
                properties: {
                  runId: {
                    type: 'string',
                    description: "The build's Workflow instance id.",
                  },
                  startedAt: {
                    type: 'string',
                  },
                },
              },
              {
                type: 'null',
              },
            ],
          },
        },
      },
      ProjectEnvelope: {
        type: 'object',
        required: ['project'],
        properties: {
          project: {
            $ref: '#/components/schemas/Project',
          },
        },
      },
      ProjectFile: {
        type: 'object',
        required: ['path', 'content'],
        properties: {
          path: {
            type: 'string',
          },
          content: {
            type: 'string',
          },
        },
      },
      ProjectId: {
        type: 'string',
        pattern: '^[A-Za-z0-9_-]{1,128}$',
      },
      ProjectLimitError: {
        allOf: [
          {
            $ref: '#/components/schemas/Error',
          },
          {
            type: 'object',
            required: ['code', 'limit'],
            properties: {
              code: {
                type: 'string',
                const: 'project-limit',
              },
              limit: {
                oneOf: [
                  {
                    type: 'integer',
                  },
                  {
                    type: 'null',
                  },
                ],
              },
            },
          },
        ],
      },
      ProjectList: {
        type: 'object',
        required: ['projects', 'limits'],
        properties: {
          projects: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/Project',
            },
          },
          limits: {
            type: 'object',
            required: ['tier', 'active', 'maxActive'],
            properties: {
              tier: {
                type: 'string',
                enum: ['free', 'build', 'ship'],
              },
              active: {
                type: 'integer',
                description: 'Projects not archived.',
              },
              maxActive: {
                oneOf: [
                  {
                    type: 'integer',
                    description:
                      'The active project limit; null for unlimited.',
                  },
                  {
                    type: 'null',
                  },
                ],
              },
            },
          },
        },
      },
      ProjectPatchRequest: {
        type: 'object',
        description:
          'Every field is optional and all of them are validated before anything is written. Settings and transcript saves are versioned; a rename or an archive is never refused for being stale.',
        properties: {
          name: {
            type: 'string',
            description:
              'A new name; one that is blank after cleaning is refused with 400.',
          },
          archived: {
            type: 'boolean',
          },
          settings: {
            $ref: '#/components/schemas/ProjectSettingsInput',
          },
          transcript: {
            type: 'array',
            maxItems: 2000,
            items: {
              $ref: '#/components/schemas/TranscriptTurn',
            },
            description:
              'The whole conversation, replacing the stored one. At most 2 MiB as JSON.',
          },
          version: {
            type: 'integer',
            minimum: 0,
            description:
              'The version this save was made from. Absent, the save always wins.',
          },
          writer: {
            type: 'string',
            pattern: '^[A-Za-z0-9-]{1,64}$',
            description:
              "The saving page's own id. Only read when `version` is present.",
          },
        },
      },
      ProjectSettings: {
        type: 'object',
        description: "A project's saved build settings.",
        required: [
          'style',
          'referenceUrl',
          'model',
          'knowledge',
          'styleDna',
          'galleryStyle',
          'galleryColors',
        ],
        properties: {
          style: {
            oneOf: [
              {
                type: 'string',
                description: 'The style preset id.',
              },
              {
                type: 'null',
              },
            ],
          },
          referenceUrl: {
            oneOf: [
              {
                type: 'string',
                maxLength: 2048,
              },
              {
                type: 'null',
              },
            ],
          },
          model: {
            oneOf: [
              {
                type: 'string',
                description:
                  "The chosen model id; null for the browser's choice.",
              },
              {
                type: 'null',
              },
            ],
          },
          knowledge: {
            oneOf: [
              {
                type: 'string',
                maxLength: 2000,
                description:
                  'Standing instructions. Null means never set; the empty string means set to none.',
              },
              {
                type: 'null',
              },
            ],
          },
          styleDna: {
            oneOf: [
              {
                type: 'object',
                additionalProperties: {
                  type: 'string',
                },
                description:
                  'Visual preferences by style dimension. `{}` means set to none.',
              },
              {
                type: 'null',
              },
            ],
          },
          galleryStyle: {
            oneOf: [
              {
                type: 'string',
                description: 'The style gallery style id.',
              },
              {
                type: 'null',
              },
            ],
          },
          galleryColors: {
            oneOf: [
              {
                type: 'object',
                maxProperties: 24,
                additionalProperties: {
                  type: 'string',
                },
                description: 'Color edits for the gallery style, by token.',
              },
              {
                type: 'null',
              },
            ],
          },
        },
      },
      ProjectSettingsInput: {
        type: 'object',
        description:
          'Settings to write. An absent field is left unchanged; a field present as null is cleared. An unknown style preset, model, gallery style or malformed color edit is stored as null rather than refused. Naming both `style` and `galleryStyle` is refused with 400; choosing one clears the other, and `galleryColors` is cleared unless sent with a gallery style.',
        properties: {
          style: {
            oneOf: [
              {
                type: 'string',
              },
              {
                type: 'null',
              },
            ],
          },
          referenceUrl: {
            oneOf: [
              {
                type: 'string',
                maxLength: 2048,
              },
              {
                type: 'null',
              },
            ],
          },
          model: {
            oneOf: [
              {
                type: 'string',
              },
              {
                type: 'null',
              },
            ],
          },
          knowledge: {
            oneOf: [
              {
                type: 'string',
                maxLength: 2000,
              },
              {
                type: 'null',
              },
            ],
          },
          styleDna: {
            oneOf: [
              {
                type: 'object',
                additionalProperties: {
                  type: 'string',
                },
              },
              {
                type: 'null',
              },
            ],
          },
          galleryStyle: {
            oneOf: [
              {
                type: 'string',
              },
              {
                type: 'null',
              },
            ],
          },
          galleryColors: {
            oneOf: [
              {
                type: 'object',
                additionalProperties: {
                  type: 'string',
                },
              },
              {
                type: 'null',
              },
            ],
          },
        },
      },
      ProjectShareState: {
        type: 'object',
        required: ['on', 'url', 'held'],
        properties: {
          on: {
            type: 'boolean',
            description: 'Whether the share link is turned on.',
          },
          url: {
            oneOf: [
              {
                type: 'string',
                format: 'uri',
                description: 'The share link; null while it is off.',
              },
              {
                type: 'null',
              },
            ],
          },
          held: {
            type: 'boolean',
            description: 'Whether an operator has stopped the link.',
          },
        },
      },
      ProjectSite: {
        type: 'object',
        required: ['slug', 'state', 'url'],
        properties: {
          slug: {
            type: 'string',
          },
          state: {
            type: 'string',
            enum: ['live', 'down', 'held'],
          },
          url: {
            type: 'string',
            format: 'uri',
          },
        },
      },
      ProjectSnapshot: {
        type: 'object',
        required: ['revision', 'files'],
        properties: {
          revision: {
            type: 'string',
          },
          files: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/ProjectFile',
            },
          },
        },
      },
      PublishRequest: {
        type: 'object',
        required: ['files'],
        properties: {
          files: {
            type: 'array',
            minItems: 1,
            maxItems: 50,
            items: {
              $ref: '#/components/schemas/StagedFile',
            },
            description: "The accepted checkpoint's source.",
          },
          slug: {
            type: 'string',
            description:
              'The address to publish under. Non-empty if present; checked by the publish service.',
            minLength: 1,
          },
          projectId: {
            type: ['string', 'null'],
            pattern: '^[A-Za-z0-9_-]{1,128}$',
          },
        },
      },
      PublishResult: {
        type: 'object',
        required: ['slug', 'url', 'skipped'],
        properties: {
          slug: {
            type: 'string',
          },
          url: {
            type: 'string',
            description: 'The live site.',
          },
          skipped: {
            type: 'array',
            items: {
              type: 'string',
            },
            description: 'Reported by the build service.',
          },
        },
      },
      PushConflict: {
        type: 'object',
        required: ['branch', 'existingSha', 'attemptedTreeSha'],
        properties: {
          branch: {
            type: 'string',
          },
          existingSha: {
            type: 'string',
          },
          attemptedTreeSha: {
            type: 'string',
          },
        },
      },
      RedirectUrl: {
        type: 'object',
        required: ['url'],
        properties: {
          url: {
            type: 'string',
            format: 'uri',
            description: 'A Stripe-hosted page to navigate the browser to.',
          },
        },
      },
      ReferralClaimRequest: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'The referral code this account arrived with.',
          },
        },
      },
      ReferralClaimResult: {
        type: 'object',
        required: ['recorded'],
        properties: {
          recorded: {
            type: 'boolean',
            const: true,
            description:
              'Always true, whatever happened; whether an attribution was written is not disclosed.',
          },
        },
      },
      ReferralStatus: {
        type: 'object',
        required: [
          'code',
          'url',
          'referred',
          'paid',
          'earnedCents',
          'rewardCents',
          'maxPaidReferrals',
        ],
        properties: {
          code: {
            type: 'string',
            description: "The caller's referral code, issued on first request.",
          },
          url: {
            type: 'string',
            format: 'uri',
            description:
              'The referral link, with the code in its `ref` query parameter.',
          },
          referred: {
            type: 'integer',
            description: 'Accounts attributed to this code.',
          },
          paid: {
            type: 'integer',
            description: 'Referrals that have been paid.',
          },
          earnedCents: {
            type: 'integer',
            description: 'Credit earned from referrals, in US cents.',
          },
          rewardCents: {
            type: 'object',
            required: ['referrer', 'referred'],
            properties: {
              referrer: {
                type: 'integer',
              },
              referred: {
                type: 'integer',
              },
            },
            description: 'The reward on each side, in US cents.',
          },
          maxPaidReferrals: {
            type: 'integer',
            description: 'How many referrals one account can be paid for.',
          },
        },
      },
      RefusalError: {
        type: 'object',
        description:
          'An error that also names which refusal it is. `reason` is the stable contract; `error` is prose and may change.',
        required: ['error'],
        properties: {
          error: {
            type: 'string',
            description: 'A sentence for the person reading it.',
          },
          reason: {
            type: 'string',
            enum: [
              'not-configured',
              'not-signed-in',
              'access-refused',
              'rate-limited',
              'model-not-allowed',
              'request-invalid',
              'account-ceiling',
              'already-running',
              'accounting-unavailable',
              'deletion-scheduled',
              'account-suspended',
              'account-banned',
            ],
          },
          accessRefused: {
            type: 'boolean',
            const: true,
            description: "Present on the invite gate's refusal.",
          },
          purgeAfter: {
            type: 'string',
            description:
              'When the account will be purged. Present with reason `deletion-scheduled`.',
          },
        },
      },
      RepositoryRef: {
        type: 'object',
        required: ['owner', 'repo'],
        properties: {
          owner: {
            type: 'string',
          },
          repo: {
            type: 'string',
          },
        },
      },
      RunHistory: {
        type: 'object',
        required: ['runs'],
        properties: {
          runs: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/RunTrace',
            },
            maxItems: 20,
          },
        },
      },
      RunResponse: {
        type: 'object',
        required: ['run', 'snapshot'],
        properties: {
          run: {
            $ref: '#/components/schemas/RunView',
          },
          snapshot: {
            oneOf: [
              {
                $ref: '#/components/schemas/RunSnapshot',
              },
              {
                type: 'null',
              },
            ],
          },
        },
      },
      RunSnapshot: {
        type: 'object',
        required: ['revision', 'files'],
        properties: {
          revision: {
            type: 'string',
          },
          files: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/ProjectFile',
            },
          },
        },
      },
      RunStepTrace: {
        type: 'object',
        required: ['name', 'ms', 'outputTokens'],
        properties: {
          name: {
            type: 'string',
            description:
              "The step's name, such as `outline`, `write-2.1` or `assemble`. At most 64 characters.",
          },
          ms: {
            type: 'integer',
          },
          outputTokens: {
            type: 'integer',
            description:
              'Reasoning included. Zero for a step with no model call.',
          },
          reasoningTokens: {
            type: 'integer',
            description: 'Where reported.',
          },
        },
      },
      RunStopResponse: {
        type: 'object',
        required: ['run'],
        properties: {
          run: {
            $ref: '#/components/schemas/RunView',
          },
        },
      },
      RunTrace: {
        type: 'object',
        description: 'What a finished run is worth recording: metadata only.',
        required: [
          'runId',
          'projectId',
          'stop',
          'model',
          'inputTokens',
          'cachedInputTokens',
          'outputTokens',
          'contextWindow',
          'costMicroUsd',
          'elapsedMs',
          'endedAt',
        ],
        properties: {
          runId: {
            type: 'string',
          },
          projectId: {
            type: 'string',
          },
          stop: {
            type: 'string',
            enum: [
              'applied',
              'no-changes',
              'cancelled',
              'validation-failed',
              'model-refused',
              'model-truncated',
              'model-shape',
              'context-exceeded',
              'run-budget-exceeded',
              'provider-error',
              'awaiting-answer',
              'retained',
              'conflict',
              'store-unavailable',
              'not-started',
            ],
            description:
              'Why the run ended. A stored value this build does not know is read as `provider-error`.',
          },
          model: {
            type: 'string',
          },
          inputTokens: {
            type: 'integer',
          },
          cachedInputTokens: {
            type: 'integer',
          },
          outputTokens: {
            type: 'integer',
          },
          reasoningTokens: {
            type: 'integer',
            description: 'Absent where no call reported it.',
          },
          steps: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/RunStepTrace',
            },
            description: 'Absent on older runs.',
          },
          contextWindow: {
            type: 'integer',
          },
          costMicroUsd: {
            type: 'integer',
          },
          elapsedMs: {
            type: 'integer',
          },
          endedAt: {
            type: 'string',
          },
        },
      },
      RunView: {
        type: 'object',
        required: ['id', 'state', 'startedAt'],
        properties: {
          id: {
            type: 'string',
          },
          state: {
            type: 'string',
            enum: ['running', 'accepted', 'failed', 'cancelled'],
          },
          startedAt: {
            type: 'string',
            description: 'When the run was created.',
          },
          revision: {
            type: ['string', 'null'],
            description: 'For `accepted`, the revision it was accepted at.',
          },
          summary: {
            type: 'string',
            description:
              'For `accepted`, what the build says it made, where still available.',
          },
          phase: {
            type: 'string',
            enum: [
              'outline',
              'writing',
              'assembling',
              'validating',
              'repairing',
            ],
            description: 'For `running`, where it has got to.',
          },
          checking: {
            type: 'object',
            description:
              'For `running`, the revision already promoted and being checked.',
            required: ['revision'],
            properties: {
              revision: {
                type: 'string',
              },
            },
          },
          check: {
            type: 'string',
            enum: ['passed', 'failed', 'unchecked'],
            description: 'For a checked `accepted` build.',
          },
        },
      },
      SavedCard: {
        type: 'object',
        required: ['brand', 'last4'],
        properties: {
          brand: {
            type: 'string',
          },
          last4: {
            type: 'string',
          },
        },
      },
      SharedProject: {
        type: 'object',
        description:
          'A shared project as anybody holding the link sees it. Nothing about the owner is included.',
        required: ['project', 'snapshot', 'livePreview'],
        properties: {
          project: {
            type: 'object',
            required: ['name'],
            properties: {
              name: {
                type: 'string',
              },
            },
          },
          snapshot: {
            oneOf: [
              {
                $ref: '#/components/schemas/ProjectSnapshot',
              },
              {
                type: 'null',
              },
            ],
          },
          livePreview: {
            type: 'boolean',
            description:
              'Whether a live preview can be run: this deployment has a preview service and the project has accepted code.',
          },
        },
      },
      SignupCreditStatus: {
        description: 'Where the account stands with the welcome credit.',
        oneOf: [
          {
            type: 'object',
            required: ['state', 'cents'],
            properties: {
              state: {
                const: 'granted',
              },
              cents: {
                type: 'integer',
              },
            },
          },
          {
            type: 'object',
            required: ['state', 'cents', 'cardAlreadyUsed'],
            properties: {
              state: {
                const: 'needs-card',
              },
              cents: {
                type: 'integer',
              },
              cardAlreadyUsed: {
                type: 'boolean',
              },
            },
          },
          {
            type: 'object',
            required: ['state', 'reason'],
            properties: {
              state: {
                const: 'none',
              },
              reason: {
                type: 'string',
                enum: [
                  'no-access',
                  'disabled',
                  'no-cohort-configured',
                  'not-in-cohort',
                  'age-unknown',
                  'error',
                ],
              },
            },
          },
        ],
      },
      SnapshotEnvelope: {
        type: 'object',
        required: ['snapshot'],
        properties: {
          snapshot: {
            $ref: '#/components/schemas/ProjectSnapshot',
          },
        },
      },
      StagedFile: {
        type: 'object',
        description: 'A project file as a preview or publish request sends it.',
        required: ['path', 'content'],
        properties: {
          path: {
            type: 'string',
            description:
              'Relative, canonical, forward slashes, no `..`, at most 256 characters.',
            maxLength: 256,
          },
          content: {
            type: 'string',
          },
        },
      },
      StreamErrorEvent: {
        type: 'object',
        description: 'SSE `error`: the run failed. Ends the stream.',
        required: ['error'],
        properties: {
          error: {
            type: 'string',
          },
        },
      },
      StyleCard: {
        type: 'object',
        description: 'One picker card, as the gallery asset build writes it.',
        required: [
          'id',
          'name',
          'kind',
          'group',
          'category',
          'theme',
          'style_tags',
          'signature',
          'palette',
          'fonts',
        ],
        properties: {
          id: {
            type: 'string',
          },
          name: {
            type: 'string',
          },
          kind: {
            type: 'string',
          },
          group: {
            type: 'string',
            enum: [
              'saas',
              'agency-portfolio',
              'ecommerce',
              'general',
              'ai',
              'design-tools',
              'devtools',
              'fintech',
              'productivity',
              'media-publishing',
              'web3',
            ],
          },
          category: {
            type: 'string',
            enum: [
              'monochrome-minimal',
              'editorial-serif',
              'dark-cinematic',
              'dark-technical',
              'warm-minimal',
              'soft-gradient',
              'clean-corporate',
              'bold-graphic',
              'vivid-playful',
            ],
          },
          theme: {
            type: 'string',
            enum: ['light', 'dark'],
          },
          style_tags: {
            type: 'array',
            items: {
              type: 'string',
            },
          },
          signature: {
            type: 'array',
            items: {
              type: 'string',
            },
          },
          palette: {
            type: 'array',
            items: {
              type: 'object',
              required: ['role', 'hex'],
              properties: {
                role: {
                  type: 'string',
                },
                hex: {
                  type: 'string',
                },
              },
            },
          },
          fonts: {
            type: 'object',
            required: ['display', 'body'],
            properties: {
              display: {
                type: 'string',
              },
              body: {
                type: 'string',
              },
            },
          },
        },
      },
      StyleColorSubject: {
        type: 'object',
        description:
          "One style's colors and contrast pairs, for the builder's color editor.",
        required: ['id', 'design_tokens', 'contrast_checks'],
        properties: {
          id: {
            type: 'string',
          },
          design_tokens: {
            type: 'object',
            required: ['colors'],
            properties: {
              colors: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['token', 'role', 'hex'],
                  properties: {
                    token: {
                      type: 'string',
                      description:
                        'A CSS custom property such as `--color-canvas`.',
                    },
                    role: {
                      type: 'string',
                    },
                    hex: {
                      type: 'string',
                    },
                  },
                },
              },
            },
          },
          contrast_checks: {
            type: 'array',
            items: {
              type: 'object',
              required: ['use', 'fg', 'bg', 'target'],
              properties: {
                use: {
                  type: 'string',
                },
                fg: {
                  type: 'string',
                },
                bg: {
                  type: 'string',
                },
                ratio: {
                  type: ['number', 'null'],
                  description: 'Absent on a decorative pair.',
                },
                target: {
                  type: 'number',
                },
              },
            },
          },
        },
      },
      TemplateBrief: {
        type: 'object',
        required: ['brief'],
        properties: {
          brief: {
            type: 'string',
          },
        },
      },
      TranscriptTurn: {
        type: 'object',
        description:
          'One prompt and what became of it. Text fields are limited to 20,000 characters.',
        required: [
          'id',
          'runId',
          'prompt',
          'at',
          'status',
          'summary',
          'fileCount',
          'revision',
          'problem',
          'providerId',
        ],
        properties: {
          id: {
            type: 'number',
          },
          runId: {
            type: 'string',
          },
          prompt: {
            type: 'string',
          },
          at: {
            type: 'number',
          },
          status: {
            type: 'string',
            enum: ['running', 'accepted', 'failed', 'cancelled', 'replied'],
          },
          agentMessage: {
            oneOf: [
              {
                type: 'string',
              },
              {
                type: 'null',
              },
            ],
          },
          summary: {
            oneOf: [
              {
                type: 'string',
              },
              {
                type: 'null',
              },
            ],
          },
          fileCount: {
            type: 'number',
          },
          revision: {
            oneOf: [
              {
                type: 'string',
              },
              {
                type: 'null',
              },
            ],
          },
          problem: {
            oneOf: [
              {
                type: 'string',
              },
              {
                type: 'null',
              },
            ],
          },
          providerId: {
            oneOf: [
              {
                type: 'string',
              },
              {
                type: 'null',
              },
            ],
          },
          serverRunId: {
            oneOf: [
              {
                type: 'string',
              },
              {
                type: 'null',
              },
            ],
          },
          baseRevision: {
            oneOf: [
              {
                type: 'string',
              },
              {
                type: 'null',
              },
            ],
          },
        },
      },
      UnpublishRequest: {
        type: 'object',
        properties: {
          projectId: {
            type: ['string', 'null'],
            pattern: '^[A-Za-z0-9_-]{1,128}$',
          },
        },
      },
      UnpublishResult: {
        type: 'object',
        required: ['slug'],
        properties: {
          slug: {
            type: 'string',
            description: 'The slug that was taken down.',
          },
        },
      },
      UserInstallation: {
        type: 'object',
        required: ['id', 'account'],
        properties: {
          id: {
            type: 'integer',
          },
          account: {
            type: 'string',
          },
        },
      },
    },
  },
};
