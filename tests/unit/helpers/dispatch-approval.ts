/**
 * The pending dispatch-approval row the three channel ingress tests share.
 *
 * slack-, discord- and telegram-dispatch-approval-ingress.test.ts each carried
 * a byte-identical one-liner. They are asserting one policy across three
 * transports, so the fixture they compare against should be one object, not
 * three copies that can drift apart silently.
 *
 * Other `pending()` functions under tests/unit share only the name — runtime
 * request views and runtime-default migration markers — and are not this.
 */
import { dispatchApprovalStore } from '../../../src/core/dispatch-approval.js';

export function pendingDispatchApproval(): ReturnType<typeof dispatchApprovalStore.create> {
    return dispatchApprovalStore.create({
        target: { kind: 'agent', name: 'A' },
        projectRoot: '/r',
        task: 't',
        mutable: false,
        scope: null,
        fanOutCap: 1,
    });
}
