import { Fragment, useMemo } from 'react';
import { RollButton } from './RollButton';

const DICE_PATTERN = /(\d+d\d+(?:\s*[+-]\s*\d+)?)/gi;

interface RollableTextProps {
  text: string;
  className?: string;
}

/** Renders plain text with inline clickable dice expressions. */
export function RollableText({ text, className = '' }: RollableTextProps) {
  const parts = useMemo(() => {
    if (!text) return [];
    const segments: Array<{ type: 'text' | 'dice'; value: string }> = [];
    let lastIndex = 0;
    const re = new RegExp(DICE_PATTERN.source, 'gi');
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
      }
      segments.push({ type: 'dice', value: match[1]! });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      segments.push({ type: 'text', value: text.slice(lastIndex) });
    }
    return segments;
  }, [text]);

  if (parts.length === 0) return null;

  const hasDice = parts.some((p) => p.type === 'dice');
  if (!hasDice) {
    return (
      <pre
        className={`font-ui text-xs whitespace-pre-wrap leading-relaxed ${className}`}
        style={{ color: 'var(--color-text-primary)' }}
      >
        {text}
      </pre>
    );
  }

  return (
    <pre
      className={`font-ui text-xs whitespace-pre-wrap leading-relaxed ${className}`}
      style={{ color: 'var(--color-text-primary)' }}
    >
      {parts.map((part, i) =>
        part.type === 'text' ? (
          <Fragment key={i}>{part.value}</Fragment>
        ) : (
          <RollButton
            key={i}
            notation={part.value.replace(/\s+/g, '')}
            label={part.value.trim()}
            variant="damage"
            className="inline align-baseline mx-0.5"
          />
        ),
      )}
    </pre>
  );
}
