import type { ReactNode } from 'react';

type Props = {
  id: string;
  title: string;
  count?: string;
  hidden?: boolean;
  children: ReactNode;
  headExtra?: ReactNode;
};

export function Column({ id, title, count, hidden, children, headExtra }: Props) {
  return (
    <section
      className="col"
      id={`col-${id}`}
      role="tabpanel"
      aria-labelledby={`tab-${id}`}
      aria-label={title}
      data-hidden={hidden ? 'true' : 'false'}
    >
      <div className="colhead">
        <h2>{title}</h2>
        <span className="count">{count}</span>
      </div>
      {headExtra}
      {children}
    </section>
  );
}
