import React from 'react';

/**
 * 极简 Markdown 渲染（不引三方库）。
 *
 * 模型输出常见 `## 标题` / `**加粗**` / `- 列表` / `| 表格 |`；
 * 直接塞进气泡里会看到一堆符号，这里把常用的几种渲染成正常排版。
 * 只做展示，不执行 HTML，避免 XSS。
 */

function inline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith('**')) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(
        <code
          key={key++}
          style={{
            background: 'rgba(0,0,0,0.05)',
            borderRadius: 4,
            padding: '0 4px',
            fontSize: 12.5,
          }}
        >
          {token.slice(1, -1)}
        </code>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes.length ? nodes : [text];
}

const H_STYLE: Record<number, React.CSSProperties> = {
  1: { fontSize: 15.5, fontWeight: 600, margin: '2px 0 6px' },
  2: { fontSize: 15, fontWeight: 600, margin: '2px 0 6px' },
  3: { fontSize: 14, fontWeight: 600, margin: '2px 0 4px' },
};

export default function MarkdownText({ text }: { text: string }) {
  const lines = (text || '').split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let table: string[][] = [];
  let key = 0;

  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, i) => <li key={i}>{inline(item)}</li>);
    blocks.push(
      list.ordered ? (
        <ol key={key++} style={{ margin: '4px 0', paddingLeft: 20, lineHeight: 1.8 }}>{items}</ol>
      ) : (
        <ul key={key++} style={{ margin: '4px 0', paddingLeft: 18, lineHeight: 1.8 }}>{items}</ul>
      ),
    );
    list = null;
  };

  const flushTable = () => {
    if (table.length === 0) return;
    const rows = table.filter((row) => !row.every((cell) => /^:?-{2,}:?$/.test(cell.trim())));
    const [head, ...body] = rows;

    // 列太多时表格在窄气泡里没法看：改成「每行一张小卡片」
    if ((head?.length ?? 0) > 3) {
      blocks.push(
        <div key={key++} style={{ display: 'grid', gap: 6, margin: '6px 0' }}>
          {body.map((row, r) => (
            <div
              key={r}
              style={{
                border: '1px solid rgba(0,0,0,0.08)',
                borderRadius: 6,
                padding: '6px 8px',
                fontSize: 12.5,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 2 }}>{inline(row[0]?.trim() ?? '')}</div>
              {row.slice(1).map((cell, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, lineHeight: 1.6 }}>
                  <span style={{ color: '#8a919f', flex: '0 0 64px' }}>{head?.[i + 1]?.trim()}</span>
                  <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{inline(cell.trim())}</span>
                </div>
              ))}
            </div>
          ))}
        </div>,
      );
      table = [];
      return;
    }

    blocks.push(
      <div key={key++} style={{ overflowX: 'auto', margin: '6px 0' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: '100%' }}>
          <thead>
            <tr>
              {(head ?? []).map((cell, i) => (
                <th
                  key={i}
                  style={{
                    textAlign: 'left',
                    padding: '4px 8px',
                    borderBottom: '1px solid rgba(0,0,0,0.12)',
                    background: 'rgba(0,0,0,0.03)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {inline(cell.trim())}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r}>
                {row.map((cell, i) => (
                  <td
                    key={i}
                    style={{
                      padding: '4px 8px',
                      borderBottom: '1px solid rgba(0,0,0,0.06)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {inline(cell.trim())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    table = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      flushTable();
      continue;
    }

    if (trimmed.startsWith('|')) {
      flushList();
      const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|');
      table.push(cells);
      continue;
    }
    flushTable();

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushList();
      const level = Math.min(heading[1].length, 3);
      const style = H_STYLE[level] ?? H_STYLE[3];
      blocks.push(
        <div key={key++} style={style}>
          {inline(heading[2])}
        </div>,
      );
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
      continue;
    }

    const ordered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (ordered) {
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ordered[1]);
      continue;
    }

    flushList();
    blocks.push(
      <p key={key++} style={{ margin: '4px 0', lineHeight: 1.75 }}>
        {inline(trimmed)}
      </p>,
    );
  }

  flushList();
  flushTable();
  return <>{blocks}</>;
}
