import type { ReactNode } from 'react';
import { NARROW, useMediaQuery } from '../lib/useMediaQuery';

type Props = {
  id: string;
  title: string;
  count?: string;
  hidden?: boolean;
  children: ReactNode;
  headExtra?: ReactNode;
};

/** A region on desktop; a tab panel when the columns become tabs. */
export function Column({ id, title, count, hidden, children, headExtra }: Props) {
  const narrow = useMediaQuery(NARROW);
  return (
    <section
      className="col"
      id={`col-${id}`}
      {...(narrow ? { role: 'tabpanel', 'aria-labelledby': `tab-${id}` } : { 'aria-label': title })}
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
