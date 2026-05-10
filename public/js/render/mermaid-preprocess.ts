// Mermaid code preprocessor — pure string functions, no DOM dependencies.
// Handles common AI-generated syntax that breaks mermaid.render().

/** Layer 1: always-on static cleanup before every render attempt. */
export function preprocessMermaid(code: string): string {
    let result = code.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    result = result.replace(/;\s*$/gm, '');
    if (/^\s*(flowchart|graph)\b/m.test(result)) {
        result = normalizeFlowchartNodeIds(result);
    }
    return result;
}

const RESERVED_NODE_IDS = new Set(['end', 'default', 'class', 'style']);

function normalizeNodeId(id: string): string {
    let next = id.replace(/[/.:-]+/g, '_');
    if (RESERVED_NODE_IDS.has(next.toLowerCase())) next = `node_${next}`;
    return next;
}

function normalizeFlowchartNodeIds(code: string): string {
    return code.replace(
        /(^|[\s;])([A-Za-z_][\w/.:-]*)(?=\s*(?:\[|\(|\{|>))/gm,
        (match, prefix: string, id: string) => {
            const next = normalizeNodeId(id);
            return next === id ? match : `${prefix}${next}`;
        },
    );
}

/**
 * Layer 2: retry-phase aggressive fix — quote all unquoted flowchart/graph
 * node labels so shape-delimiter characters ([[, ((, {{, etc.) inside text
 * are treated as literal content instead of Mermaid shape syntax.
 *
 * Returns transformed code, or null if the diagram type is not flowchart/graph
 * (other diagram types don't use bracket-based shape syntax).
 */
export function sanitizeMermaidForRetry(code: string): string | null {
    if (!/^\s*(flowchart|graph)\b/m.test(code)) return null;

    const lines = code.split('\n');
    const out: string[] = [];

    for (const line of lines) {
        let result = '';
        let i = 0;

        while (i < line.length) {
            const rest = line.slice(i);
            const nodeMatch = rest.match(/^([A-Za-z_]\w*)\[(?!")/);
            if (nodeMatch) {
                const nodeId = nodeMatch[1];
                result += nodeId + '["';
                i += nodeMatch[0].length;

                let depth = 1;
                let label = '';
                while (i < line.length && depth > 0) {
                    const ch = line[i];
                    if (ch === '[') depth++;
                    else if (ch === ']') depth--;
                    if (depth > 0) label += ch;
                    i++;
                }
                label = label.replace(/"/g, '#quot;');
                result += label + '"]';
            } else {
                result += line[i];
                i++;
            }
        }
        out.push(result);
    }
    return out.join('\n');
}
