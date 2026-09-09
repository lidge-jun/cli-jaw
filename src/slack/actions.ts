import type { ActionDefinition } from './action-types.js';
import { messageActions } from './actions-message.js';
import { scheduleActions } from './actions-schedule.js';
import { channelActions } from './actions-channel.js';
import { resourceActions } from './actions-resources.js';
import { rtsActions } from './actions-rts.js';
import { interactionActions } from './actions-interactions.js';

/** Explicit operations only. No client-supplied Web API method is dispatched. */
export const slackActions: readonly ActionDefinition[] = Object.freeze([
    ...messageActions, ...scheduleActions, ...channelActions, ...resourceActions, ...rtsActions, ...interactionActions,
]);
const byOperation = new Map(slackActions.map(action => [action.operation, action]));
if (byOperation.size !== slackActions.length) throw new Error('duplicate_slack_action');
export function slackAction(operation: unknown): ActionDefinition | undefined {
    return typeof operation === 'string' ? byOperation.get(operation) : undefined;
}
