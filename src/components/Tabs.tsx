export type TabId = 'transcript' | 'summary' | 'watch';

const TABS: { id: TabId; label: string }[] = [
  { id: 'transcript', label: 'Transcript' },
  { id: 'summary', label: 'Summary' },
  { id: 'watch', label: 'Watch list' },
];

type Props = { active: TabId; onChange: (t: TabId) => void; newFlags: number };

/** Shown only below 980 px (CSS). Columns become tabs there. */
export function Tabs({ active, onChange, newFlags }: Props) {
  return (
    <div className="tabs" role="tablist" aria-label="Views">
      {TABS.map((t) => (
        <button
          key={t.id}
          id={`tab-${t.id}`}
          role="tab"
          className="tab"
          aria-selected={active === t.id}
          aria-controls={`col-${t.id}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.id === 'watch' && newFlags > 0 && (
            <span className="badge" aria-label={`${newFlags} new`}>
              {newFlags}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
