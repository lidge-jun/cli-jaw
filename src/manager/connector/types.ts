export type ConnectorActor = 'agent' | 'user' | 'system';

export type ConnectorSurface = 'board' | 'reminders' | 'notes';

export type ConnectorInstanceLink = {
    port: number | null;
    threadKey: string | null;
    messageId: string | null;
};

export type ConnectorAuditEvent = {
    id: string;
    surface: ConnectorSurface;
    action: string;
    targetId: string | null;
    actor: ConnectorActor;
    instanceLink: ConnectorInstanceLink | null;
    createdAt: string;
};

export type ConnectorErrorCode =
    | 'connector_not_user_requested'
    | 'connector_invalid_input'
    | 'connector_target_not_found'
    | 'connector_surface_failed'
    | 'connector_audit_failed';
