import { KIND } from './labels';
import { formatLine } from '../analysis/buildRequest';
import { mmss } from './time';
import type { ClientFlag, Session } from '../store/types';

function flagBlock(f: ClientFlag): string {
  const tag = `**[${KIND[f.type]}]** ${f.title}${f.status === 'pinned' ? ' (pinned)' : ''}`;
  const out = [`- ${tag}`];
  if (f.quote) out.push(`  > “${f.quote}”${f.who ? ` — ${f.who}` : ''}`);
  if (f.why) out.push(`  Why: ${f.why}`);
  if (f.ask) out.push(`  Ask: ${f.ask}`);
  return out.join('\n');
}

/** Notes as Markdown (US-07): summary by topic, then the watch list with pinned and asked items. */
export function notesMarkdown(
  s: Session,
  opts: { includeTranscript: boolean; now?: Date },
): string {
  const date = (opts.now ?? new Date(s.startedAt)).toLocaleDateString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const last = s.lines.at(-1);
  const parts: string[] = [`# Meeting notes — ${date}`];
  const meta = [`Language: ${s.language === 'ro-RO' ? 'Romanian' : 'English'}`];
  if (last) meta.push(`Length: ${mmss(last.t)}`);
  parts.push(`_${meta.join(' · ')}_`);
  if (s.context.trim()) parts.push(`**Context:** ${s.context.trim()}`);

  if (s.summary) {
    parts.push('## Summary');
    if (s.summary.tldr) parts.push(s.summary.tldr);
    for (const t of s.summary.topics) {
      const rows = [
        ...t.points.map((x) => `- ${x}`),
        ...t.decisions.map((x) => `- **Decided:** ${x}`),
        ...t.actions.map((x) => `- **Action:** ${x}`),
        ...t.open.map((x) => `- **Open:** ${x}`),
      ];
      parts.push(`### ${t.topic}\n${rows.join('\n')}`);
    }
  } else {
    parts.push('## Summary\n_No analysis yet._');
  }

  const live = s.flags
    .filter((f) => f.status === 'active' || f.status === 'pinned')
    .sort(
      (a, b) =>
        Number(b.status === 'pinned') - Number(a.status === 'pinned') ||
        a.firstSeenAt - b.firstSeenAt,
    );
  const asked = s.flags
    .filter((f) => f.status === 'asked')
    .sort((a, b) => a.firstSeenAt - b.firstSeenAt);
  if (live.length || asked.length) {
    parts.push('## Watch list');
    if (live.length) parts.push(live.map(flagBlock).join('\n'));
    if (asked.length) parts.push(`### Asked\n${asked.map(flagBlock).join('\n')}`);
  }

  if (opts.includeTranscript && s.lines.length) {
    const rows = s.lines.map((_, i) => formatLine(s, i));
    parts.push(`## Transcript\n${rows.join('\n')}`);
  }
  return parts.join('\n\n') + '\n';
}
