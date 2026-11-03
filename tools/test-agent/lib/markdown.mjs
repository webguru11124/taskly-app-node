// Agent-authored text is untrusted. Before it reaches a PR comment it is
// stripped of HTML, mentions, links and images, flattened, and truncated.

// Zero-width space: breaks @mentions, links and images without changing how text reads.
const ZWSP = String.fromCharCode(0x200b);
// C0 controls (except tab and newline), DEL, zero-width and bidi/line-separator characters.
const INVISIBLE = new RegExp('[\u0000-\u0008\u000b-\u001f\u007f\u200b-\u200f\u2028-\u202e]', 'g');

export function safeText(value, max = 300) {
  let text = String(value ?? '').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
  if (text.length > max) text = `${text.slice(0, max - 1)}…`;
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@(?=[\w-])/g, `@${ZWSP}`)
    .replace(/!\[/g, `!${ZWSP}[`)
    .replace(/\]\(/g, `]${ZWSP}(`)
    .replace(/\bhttps?:\/\//gi, (scheme) => `${scheme.slice(0, -3)}:${ZWSP}//`)
    .replace(/\|/g, '\\|');
}

/** Inline code for a repo path, or plain safe text when it doesn't look like one. */
export function codePath(value) {
  const text = String(value ?? '');
  return /^[\w@+.-]+(?:\/[\w@+.-]+)*$/.test(text) && text.length <= 200 ? `\`${text}\`` : safeText(text, 120);
}

export function table(headers, rows) {
  if (!rows.length) return '';
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

export function details(summary, body) {
  return body ? `<details><summary>${summary}</summary>\n\n${body}\n\n</details>` : '';
}

export function duration(ms) {
  if (!Number.isFinite(ms)) return 'n/a';
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
