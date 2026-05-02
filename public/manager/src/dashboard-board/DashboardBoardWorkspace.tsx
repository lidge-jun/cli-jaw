import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { DashboardInstance } from '../types';
import { BOARD_LANES, type BoardLane } from './DashboardBoardSidebar';
import { listTasks, createTask, updateTask, deleteTask, type DashboardTask } from './board-api';

type BoardCard = {
    id: string;
    title: string;
    lane: BoardLane;
    port: number | null;
    source: string;
    persisted: boolean;
};

type Props = {
    active: boolean;
    activeLane: BoardLane;
    instances: DashboardInstance[];
    selectedPort: number | null;
    titlesByPort: Record<number, string>;
    busyPorts: Set<number>;
};

// ---------------------------------------------------------------------------
// Board model (2026-05-02 redesign):
// - Kanban lanes always exist and only contain persisted user tasks.
// - Running instances render in a separate "pool" above the lanes as draggable
//   chips. Dragging a chip into a persisted card attaches that port to the card
//   as child context — it does NOT alter the instance itself.
// - Persisted cards are draggable across lanes.
// - No port focus / filter. All persisted tasks render unconditionally.
// - Legacy `deriveCards` removed; per-port focus toggle removed.
// ---------------------------------------------------------------------------
type RunningChip = {
    port: number;
    label: string;
    activity: string | null;
    state: 'busy' | 'online' | 'error';
};

const RUNNING_CHIP_MIME = 'application/x-jaw-running-chip';
const BOARD_TASK_MIME = 'application/x-jaw-board-task';

function deriveRunningChips(
    instances: DashboardInstance[],
    titlesByPort: Record<number, string>,
    busyPorts: Set<number>,
): RunningChip[] {
    const chips: RunningChip[] = [];
    const seen = new Set<number>();
    for (const instance of instances) {
        if (instance.hidden) continue;
        const port = instance.port;
        if (seen.has(port)) continue;
        seen.add(port);
        const isBusy = busyPorts.has(port);
        const isOnline = instance.status === 'online';
        const isError = instance.status === 'error';
        if (!isBusy && !isOnline && !isError) continue;
        chips.push({
            port,
            label: instance.label || instance.instanceId || `Port ${port}`,
            activity: titlesByPort[port] || null,
            state: isBusy ? 'busy' : isError ? 'error' : 'online',
        });
    }
    return chips;
}

function encodeRunningChip(chip: RunningChip): string {
    return JSON.stringify({
        port: chip.port,
        label: chip.label,
        activity: chip.activity,
        state: chip.state,
    });
}

function decodeRunningChip(e: DragEvent): RunningChip | null {
    const raw = e.dataTransfer.getData(RUNNING_CHIP_MIME);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as Partial<RunningChip>;
        if (typeof parsed.port !== 'number') return null;
        return {
            port: parsed.port,
            label: typeof parsed.label === 'string' ? parsed.label : `Port ${parsed.port}`,
            activity: typeof parsed.activity === 'string' ? parsed.activity : null,
            state: parsed.state === 'busy' || parsed.state === 'error' ? parsed.state : 'online',
        };
    } catch {
        return null;
    }
}

function encodeBoardTask(card: BoardCard): string {
    return JSON.stringify({ id: card.id, lane: card.lane });
}

function decodeBoardTask(e: DragEvent): { id: string; lane: BoardLane } | null {
    const raw = e.dataTransfer.getData(BOARD_TASK_MIME);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as Partial<{ id: string; lane: BoardLane }>;
        if (typeof parsed.id !== 'string') return null;
        const lane = BOARD_LANES.find(candidate => candidate.id === parsed.lane)?.id;
        if (!lane) return null;
        return { id: parsed.id, lane };
    } catch {
        return null;
    }
}

function hasDragType(e: DragEvent, type: string): boolean {
    return Array.from(e.dataTransfer.types).includes(type);
}

function taskToCard(t: DashboardTask): BoardCard {
    return {
        id: t.id,
        title: t.title,
        lane: t.lane,
        port: t.port,
        source: t.source,
        persisted: true,
    };
}

export function DashboardBoardWorkspace(props: Props) {
    const [tasks, setTasks] = useState<DashboardTask[]>([]);
    const [composerLane, setComposerLane] = useState<BoardLane | null>(null);
    const [composerTitle, setComposerTitle] = useState('');
    const [busy, setBusy] = useState(false);
    const [movePopoverFor, setMovePopoverFor] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<BoardLane | null>(null);
    const [cardDropTarget, setCardDropTarget] = useState<string | null>(null);
    const popoverRef = useRef<HTMLDivElement | null>(null);

    const reload = useCallback(async () => {
        try { setTasks(await listTasks()); }
        catch { /* ignore */ }
    }, []);

    useEffect(() => {
        if (!props.active) return;
        void reload();
    }, [props.active, reload]);

    useEffect(() => {
        if (!movePopoverFor) return;
        const handler = (e: MouseEvent) => {
            if (!popoverRef.current) return;
            if (!popoverRef.current.contains(e.target as Node)) setMovePopoverFor(null);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [movePopoverFor]);

    const onAdd = useCallback(async (lane: BoardLane) => {
        const title = composerTitle.trim();
        if (!title || busy) return;
        setBusy(true);
        try {
            await createTask({ title, lane });
            setComposerTitle('');
            setComposerLane(null);
            await reload();
        } catch { /* ignore */ }
        finally { setBusy(false); }
    }, [composerTitle, busy, reload]);

    const onMove = useCallback(async (id: string, lane: BoardLane) => {
        setMovePopoverFor(null);
        try { await updateTask(id, { lane }); await reload(); }
        catch { /* ignore */ }
    }, [reload]);

    const onDelete = useCallback(async (id: string) => {
        try { await deleteTask(id); await reload(); }
        catch { /* ignore */ }
    }, [reload]);

    const onAttachInstance = useCallback(async (id: string, port: number) => {
        try { await updateTask(id, { port }); await reload(); }
        catch { /* ignore */ }
    }, [reload]);

    const onDetachInstance = useCallback(async (id: string) => {
        try { await updateTask(id, { port: null }); await reload(); }
        catch { /* ignore */ }
    }, [reload]);

    const onDropToLane = useCallback((lane: BoardLane, e: DragEvent) => {
        e.preventDefault();
        setDropTarget(null);
        const task = decodeBoardTask(e);
        if (!task || task.lane === lane) return;
        void onMove(task.id, lane);
    }, [onMove]);

    const onDropToCard = useCallback((id: string, e: DragEvent) => {
        if (!hasDragType(e, RUNNING_CHIP_MIME)) return;
        e.preventDefault();
        e.stopPropagation();
        setCardDropTarget(null);
        const chip = decodeRunningChip(e);
        if (!chip) return;
        void onAttachInstance(id, chip.port);
    }, [onAttachInstance]);

    const cards = useMemo(() => tasks.map(taskToCard), [tasks]);

    const runningChips = useMemo(
        () => deriveRunningChips(props.instances, props.titlesByPort, props.busyPorts),
        [props.instances, props.titlesByPort, props.busyPorts],
    );
    const runningChipByPort = useMemo(() => new Map(runningChips.map(chip => [chip.port, chip])), [runningChips]);

    return (
        <section className="dashboard-board-workspace" aria-hidden={!props.active}>
            <header className="dashboard-board-workspace-header">
                <div className="dashboard-board-workspace-header-text">
                    <h2>Board</h2>
                    <p className="dashboard-board-workspace-subtitle">
                        Create human-owned kanban blocks, then drag running instance blocks into a card to attach context without touching the instance itself.
                    </p>
                </div>
            </header>
            <div
                className="dashboard-board-running-pool"
                aria-label="Running instances pool"
                data-empty={runningChips.length === 0 ? 'true' : 'false'}
            >
                <span className="dashboard-board-running-pool-label">Running</span>
                {runningChips.length === 0 ? (
                    <span className="dashboard-board-running-pool-empty">
                        No running instances. Start one from the Instances tab to see it here.
                    </span>
                ) : runningChips.map(chip => (
                    <div
                        key={chip.port}
                        className="dashboard-board-running-chip"
                        data-state={chip.state}
                        draggable
                        onDragStart={e => {
                            e.dataTransfer.effectAllowed = 'copy';
                            e.dataTransfer.setData(RUNNING_CHIP_MIME, encodeRunningChip(chip));
                        }}
                        title={chip.activity ? `${chip.label} — ${chip.activity}` : chip.label}
                    >
                        <span className="dashboard-board-running-chip-port">:{chip.port}</span>
                        <span className="dashboard-board-running-chip-label">{chip.label}</span>
                        {chip.activity ? (
                            <span className="dashboard-board-running-chip-activity">{chip.activity}</span>
                        ) : null}
                        <span className="dashboard-board-running-chip-state" data-state={chip.state}>
                            {chip.state}
                        </span>
                    </div>
                ))}
            </div>
            <div className="dashboard-board-lanes">
                {BOARD_LANES.map(lane => {
                    const laneCards = cards.filter(card => card.lane === lane.id);
                    const isComposing = composerLane === lane.id;
                    const isDropTarget = dropTarget === lane.id;
                    return (
                        <div
                            key={lane.id}
                            className={`dashboard-board-lane${props.activeLane === lane.id ? ' is-focused' : ''}${isDropTarget ? ' is-drop-target' : ''}`}
                            onDragOver={e => {
                                if (hasDragType(e, BOARD_TASK_MIME)) {
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = 'move';
                                    if (dropTarget !== lane.id) setDropTarget(lane.id);
                                }
                            }}
                            onDragLeave={() => {
                                if (dropTarget === lane.id) setDropTarget(null);
                            }}
                            onDrop={e => onDropToLane(lane.id, e)}
                        >
                            <header className="dashboard-board-lane-header">
                                <span className="dashboard-board-lane-title">{lane.label}</span>
                                <span className="dashboard-board-lane-count">{laneCards.length}</span>
                            </header>
                            <ul className="dashboard-board-lane-cards">
                                {laneCards.length === 0 ? (
                                    <li className="dashboard-board-lane-empty">No items</li>
                                ) : laneCards.map(card => {
                                    const assignedChip = card.port === null ? null : runningChipByPort.get(card.port) ?? null;
                                    const isCardDropTarget = cardDropTarget === card.id;
                                    return (
                                        <li
                                            key={card.id}
                                            className={`dashboard-board-card${isCardDropTarget ? ' is-instance-drop-target' : ''}`}
                                            data-source={card.source}
                                            data-persisted={card.persisted ? 'true' : 'false'}
                                            draggable
                                            onDragStart={e => {
                                                e.dataTransfer.effectAllowed = 'move';
                                                e.dataTransfer.setData(BOARD_TASK_MIME, encodeBoardTask(card));
                                            }}
                                            onDragOver={e => {
                                                if (hasDragType(e, RUNNING_CHIP_MIME)) {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    e.dataTransfer.dropEffect = 'copy';
                                                    if (cardDropTarget !== card.id) setCardDropTarget(card.id);
                                                }
                                            }}
                                            onDragLeave={() => {
                                                if (cardDropTarget === card.id) setCardDropTarget(null);
                                            }}
                                            onDrop={e => onDropToCard(card.id, e)}
                                        >
                                        <span className="dashboard-board-card-title">{card.title}</span>
                                        <span className="dashboard-board-card-meta">kanban block • saved</span>
                                        <div className="dashboard-board-card-instance-slot" data-empty={assignedChip ? 'false' : 'true'}>
                                            {assignedChip ? (
                                                <div
                                                    className="dashboard-board-card-instance"
                                                    data-state={assignedChip.state}
                                                    draggable
                                                    onDragStart={e => {
                                                        e.stopPropagation();
                                                        e.dataTransfer.effectAllowed = 'copy';
                                                        e.dataTransfer.setData(RUNNING_CHIP_MIME, encodeRunningChip(assignedChip));
                                                    }}
                                                    title={assignedChip.activity ? `${assignedChip.label} — ${assignedChip.activity}` : assignedChip.label}
                                                >
                                                    <span className="dashboard-board-card-instance-port">:{assignedChip.port}</span>
                                                    <span className="dashboard-board-card-instance-label">{assignedChip.label}</span>
                                                    {assignedChip.activity ? (
                                                        <span className="dashboard-board-card-instance-activity">{assignedChip.activity}</span>
                                                    ) : null}
                                                    <button
                                                        type="button"
                                                        className="dashboard-board-card-instance-detach"
                                                        onClick={() => void onDetachInstance(card.id)}
                                                        aria-label="Detach instance from card"
                                                    >Detach</button>
                                                </div>
                                            ) : (
                                                <span className="dashboard-board-card-instance-empty">Drop a running instance here</span>
                                            )}
                                        </div>
                                        {card.persisted ? (
                                            <span
                                                className="dashboard-board-card-actions"
                                                data-open={movePopoverFor === card.id ? 'true' : 'false'}
                                            >
                                                <button
                                                    type="button"
                                                    className="dashboard-board-card-action"
                                                    onMouseDown={e => e.stopPropagation()}
                                                    onClick={() => setMovePopoverFor(prev => prev === card.id ? null : card.id)}
                                                    aria-haspopup="menu"
                                                    aria-expanded={movePopoverFor === card.id}
                                                    aria-label="Move card"
                                                >Move</button>
                                                <button
                                                    type="button"
                                                    className="dashboard-board-card-action"
                                                    data-danger="true"
                                                    onClick={() => void onDelete(card.id)}
                                                    aria-label="Delete card"
                                                >Delete</button>
                                                {movePopoverFor === card.id && (
                                                    <div ref={popoverRef} className="dashboard-board-popover" role="menu">
                                                        {BOARD_LANES.map(l => (
                                                            <button
                                                                key={l.id}
                                                                type="button"
                                                                className={`dashboard-board-popover-item${l.id === card.lane ? ' is-current' : ''}`}
                                                                role="menuitem"
                                                                disabled={l.id === card.lane}
                                                                onClick={() => void onMove(card.id, l.id)}
                                                            >{l.label}{l.id === card.lane ? ' ✓' : ''}</button>
                                                        ))}
                                                    </div>
                                                )}
                                            </span>
                                        ) : null}
                                    </li>
                                    );
                                })}
                            </ul>
                            <div className="dashboard-board-lane-add">
                                {isComposing ? (
                                    <form
                                        className="dashboard-board-add-composer"
                                        onSubmit={e => { e.preventDefault(); void onAdd(lane.id); }}
                                    >
                                        <input
                                            autoFocus
                                            type="text"
                                            value={composerTitle}
                                            onChange={e => setComposerTitle(e.target.value)}
                                            placeholder={`New ${lane.label} task`}
                                            disabled={busy}
                                            aria-label={`New task for ${lane.label}`}
                                            onKeyDown={e => {
                                                if (e.key === 'Escape') {
                                                    setComposerLane(null);
                                                    setComposerTitle('');
                                                }
                                            }}
                                        />
                                        <button type="submit" disabled={busy || !composerTitle.trim()}>Add</button>
                                        <button
                                            type="button"
                                            onClick={() => { setComposerLane(null); setComposerTitle(''); }}
                                            aria-label="Cancel"
                                        >×</button>
                                    </form>
                                ) : (
                                    <button
                                        type="button"
                                        className="dashboard-board-add-trigger"
                                        onClick={() => { setComposerLane(lane.id); setComposerTitle(''); }}
                                    >+ Add task</button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
