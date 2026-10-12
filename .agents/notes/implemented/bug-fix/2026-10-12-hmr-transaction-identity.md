# Agent Note: An HMR transaction rejects by identity, not by an inherited marker

Status: implemented

English | [中文](2026-10-12-hmr-transaction-identity.zh.md)

## Problem

A settings write from the Web GUI answered `HMR transactions cannot be nested` for the whole life of one `dsh web` process while profile reloads themselves stayed healthy. The guard in `Hmr.runExclusive()` read the caller's async context as "a transaction is running", but that reading only holds for the transaction currently holding the queue: `AsyncLocalStorage` also gives every resource created during a transaction — a timer, a watcher, an HTTP listener — that transaction's store for the rest of the resource's life. The Web listener is the production case, because a profile recomposition disposes and recreates plugin entries inside the transaction, and Node hands every later request the accept-time context of the listener that accepted it. Each request then inherited a marker whose transaction had already finished, and every write a person made from the browser was rejected as a nested transaction. A fresh process with the same composition accepted the same write, which is what separated this from a profile misconfiguration.

## Decision

The HMR async context carries a per-transaction token instead of a boolean. `Hmr.runExclusive()` rejects a call only when the token it inherits is the identity of the transaction currently holding the queue; a caller holding the token of a finished transaction queues behind the queue tail like any other caller. The other two readers of the marker compare identity the same way: the HMR disposer skips waiting for pending operations only inside the running transaction, and an exact configuration watch skips draining its own refresh only there.

Rejection stays where queuing cannot make progress, because the running transaction is the queue tail: a caller that transaction awaits would wait for itself. A finished transaction awaits nothing, so the queue is exactly the serialization a caller inheriting its context needs.

## Alternatives considered

**Keep the boolean marker and reject every inherited context.** This is the defect itself: every resource created during a reload stays marked, so no later work submitted through that resource can land.

**Clear the marker when the transaction ends.** `AsyncLocalStorage.run()` cannot retract a store from resources already created inside it; only resources created afterwards would see the change.

**Escape the ambient context where the long-lived resource is created**, for example in the Web listener. The owning package cannot reach another service's `AsyncLocalStorage` instance, and every subsystem that creates a listener, timer, or watcher during a reload carries the same hazard, so the guard is the one place that sees the whole set.

**Reject and ask the person to restart.** A restart clears the marker, but it discards every running session's process, and the same reload produces the same marker again.

## Consequences

Work inherited from a finished transaction now serializes behind the queue instead of failing loudly, so a listener or timer started during a reload can still submit configuration writes afterwards; the Web GUI's preset-default write lands in a process whose listener was restarted inside a transaction. Dedicated re-entrancy protection is unchanged: a call made inside the running transaction is still rejected, which is what the existing coordination case pins. The cost is that a subsystem relying on the rejection to detect its own re-entrancy would instead have its work run later; no current consumer reads the marker for that purpose, because the marker is private to this service.

## Testing

`packages/boot/hmr/tests/coordination.spec.ts` keeps the existing case that rejects a call made inside the running transaction, and adds two: work scheduled from a timer created inside a finished transaction fulfills, and a real `node:http` listener started inside a transaction serves a request whose handler calls `runExclusive()`. The listener case fails with `HMR transactions cannot be nested` before this change.
