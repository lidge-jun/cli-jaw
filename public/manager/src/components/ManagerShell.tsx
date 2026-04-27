import type { CSSProperties, ReactNode } from 'react';

type ManagerShellProps = {
    sidebar: ReactNode;
    commandBar: ReactNode;
    detail: ReactNode;
    activity: ReactNode;
    activityHeight: number;
    sidebarCollapsed: boolean;
    mobileNav: ReactNode;
    drawer: ReactNode;
};

type ManagerShellStyle = CSSProperties & {
    '--activity-dock-height': string;
};

export function ManagerShell(props: ManagerShellProps) {
    const style: ManagerShellStyle = {
        '--activity-dock-height': `${props.activityHeight}px`,
    };

    return (
        <main className={`dashboard-shell manager-shell${props.sidebarCollapsed ? ' is-sidebar-collapsed' : ''}`} style={style}>
            <aside className="manager-sidebar" aria-label="Jaw instances">{props.sidebar}</aside>
            <header className="manager-command">{props.commandBar}</header>
            <section className="manager-detail">{props.detail}</section>
            <section className="manager-activity">{props.activity}</section>
            <nav className="manager-mobile-nav" aria-label="Mobile dashboard navigation">
                {props.mobileNav}
            </nav>
            {props.drawer}
        </main>
    );
}
