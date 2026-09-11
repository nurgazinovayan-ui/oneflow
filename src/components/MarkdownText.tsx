import { Fragment, useMemo } from 'react';
import { parseMarkdown, type Block, type Inline } from '../markdown';

// Renders the assistant's markdown as real elements instead of printing the raw asterisks.
// Everything lands as React text nodes — no dangerouslySetInnerHTML — so model output can't
// inject markup no matter what it returns.

function renderInlines(inlines: Inline[]) {
  return inlines.map((part, i) => {
    if (part.type === 'bold') return <strong key={i}>{part.text}</strong>;
    if (part.type === 'italic') return <em key={i}>{part.text}</em>;
    if (part.type === 'code') return <code key={i}>{part.text}</code>;
    return <Fragment key={i}>{part.text}</Fragment>;
  });
}

function renderBlock(block: Block, key: number) {
  switch (block.type) {
    case 'heading': {
      // Headings start at h3: these sit inside a chat message, under the panel's own headings.
      const Tag = (block.level <= 1 ? 'h3' : block.level === 2 ? 'h4' : 'h5') as 'h3' | 'h4' | 'h5';
      return (
        <Tag key={key} className="md-heading">
          {renderInlines(block.inlines)}
        </Tag>
      );
    }
    case 'list':
      return block.ordered ? (
        <ol key={key} className="md-list">
          {block.items.map((item, i) => (
            <li key={i}>{renderInlines(item)}</li>
          ))}
        </ol>
      ) : (
        <ul key={key} className="md-list">
          {block.items.map((item, i) => (
            <li key={i}>{renderInlines(item)}</li>
          ))}
        </ul>
      );
    case 'code':
      return (
        <pre key={key} className="md-code">
          <code>{block.text}</code>
        </pre>
      );
    case 'table':
      return (
        <div key={key} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {block.header.map((cell, i) => (
                  <th key={i}>{cell}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return (
        <p key={key} className="md-paragraph">
          {renderInlines(block.inlines)}
        </p>
      );
  }
}

export default function MarkdownText({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <>{blocks.map(renderBlock)}</>;
}
