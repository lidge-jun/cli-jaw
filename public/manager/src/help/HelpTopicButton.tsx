import type { HelpTopicId } from './helpContent';

type HelpTopicButtonProps = {
    topic: HelpTopicId;
    label: string;
    onOpen: (topic: HelpTopicId) => void;
    className?: string;
};

export function HelpTopicButton(props: HelpTopicButtonProps) {
    const className = props.className ? `help-topic-button ${props.className}` : 'help-topic-button';
    return (
        <button
            type="button"
            className={className}
            aria-label={props.label}
            title={props.label}
            onClick={() => props.onOpen(props.topic)}
        >
            ?
        </button>
    );
}
