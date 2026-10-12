# Agent Note: Testing a configured model from the Models page

Status: implemented

English | [中文](2026-10-12-model-connectivity-checkout.zh.md)

## Problem

The Models page could interrogate an endpoint's catalog (`llm.discoverModels`) while a provider was being declared, but nothing answered the question a person asks after configuring one: does this exact route and model answer with the key I stored? The only way to find out was to start a turn and read the failure, which spends a session and reports the failure far from the row that caused it. The mistakes a checkout catches — a revoked key, a base URL one path segment off, a model the subscription does not include, an adapter and API that do not match — otherwise surface mid-turn, after the message is already durable.

## Decision

`LlmRuntime.testModel(provider, model, signal)` runs one trivial request — a single user turn asking for the word `pong`, capped at 64 output tokens — through the adapter that owns the route, so endpoint, credential, protocol, reasoning dialect, and model gating are exercised with the route's own configuration. It writes nothing durable and needs neither an agent nor a session. Every outcome is a result (`{ ok: true }` or `{ ok: false, message }`): an unknown route, a missing credential, and an upstream refusal all reach the caller as data, so a surface renders an outcome instead of catching one. `@Remote('testModel')` exposes it as `llm/testModel`, and `LlmTestModelResult` sits on the package's `./types` subpath because the Remote boundary type must be exported from a public non-root subpath.

The Models page renders the control on a row whose route is already saved: the unplug glyph at rest, the loading ring while the request runs, and a status line naming the model, the measured round trip, or the Host's diagnostic. A route that is still a draft offers no control, because no adapter owns it yet, and a row without a model id stays disabled with its reason in the title. Copy is locale-owned like the rest of the page, and the elapsed seconds are measured around the call rather than reported by the Host, which keeps the result free of presentation facts.

## Alternatives considered

**Reuse `llm.discoverModels`.** Discovery answers what an endpoint advertises, not whether a model answers: it interrogates a draft with a one-shot credential, so it proves neither that the stored key works nor that generation succeeds.

**Report health continuously.** A background poll would need a cadence, would spend money without a person asking for it, and would put a green mark next to a route nobody has configured correctly.

**Keep the checkout in the client.** The browser holds no provider credential and speaks no adapter protocol, and rebuilding request construction there would drift from the path turns take.

**Test as part of saving.** Making a checkout part of an unrelated write would charge its cost to that write, and a provider that is legitimately unreachable would block its own configuration.

## Consequences

Configuring a model now has a cheap, explicit answer that costs one small request per click. Because the checkout goes through the registered adapter, a model its subscription does not include reports the upstream's own refusal message instead of being hidden from the list, and the round trip doubles as a rough latency signal for that route. The control appears only where a route is already saved, so a first-time provider still relies on discovery plus the first turn.

## Testing

`packages/llm/llm/tests/model-test.spec.ts` pins eight outcomes: the request the checkout sends (one user turn, 64-token cap, caller signal), an error finish, an aborted finish, a stream that ends without a finish chunk, an adapter that throws, an unregistered route, and both Remote paths. `packages/client/ui-settings-models/tests/model-connectivity.client.spec.tsx` pins the status copy for a settled checkout with its measured round trip, the glyph swap while the request is in flight, a refused checkout, a refusal with no diagnostic, a rejected carrier call as both an Error and a non-Error, an unsaved route offering no control, and the operations mapping. `pnpm run test:gui` and `pnpm run verify-client-ui-i18n` cover the assembled page.
