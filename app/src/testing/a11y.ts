import { screen } from '@testing-library/react-native';

const ROLES = new Set(['button', 'radio', 'tab', 'switch', 'checkbox', 'imagebutton', 'link']);

interface Node {
  type?: unknown;
  props?: Record<string, unknown>;
  children?: unknown[];
}

const kids = (n: Node): unknown[] => (Array.isArray(n.children) ? n.children : []);

const textOf = (n: Node): string =>
  kids(n)
    .map((c) => (typeof c === 'string' ? c : typeof c === 'object' && c ? textOf(c as Node) : ''))
    .join('')
    .trim();

function walk(n: Node, visit: (n: Node) => void): void {
  visit(n);
  for (const c of kids(n)) if (typeof c === 'object' && c) walk(c as Node, visit);
}

/**
 * Accessibility smoke check for whatever is on screen: every interactive element (button, radio, tab, switch...) must have
 * a name a screen reader can speak (an accessibilityLabel, or visible text inside it). Returns the offenders.
 */
export function unlabelledInteractives(): string[] {
  const out: string[] = [];
  const root = (screen as unknown as { container: Node }).container;
  walk(root, (n) => {
    const role = n.props?.accessibilityRole;
    if (typeof n.type !== 'string' || typeof role !== 'string' || !ROLES.has(role)) return;
    const label = n.props?.accessibilityLabel;
    if (typeof label === 'string' && label.trim()) return;
    if (textOf(n)) return;
    out.push(`${role}${n.props?.testID ? `#${String(n.props.testID)}` : ''}`);
  });
  return out;
}
