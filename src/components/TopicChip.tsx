import { topicSlot } from '../lib/topics';
import { useSession } from '../store/session';

/** A small coloured dot and the topic name, the same colour everywhere on screen (ADR-21). */
export function TopicChip({ name }: { name?: string }) {
  const topics = useSession((s) => s.session.topics);
  const slot = topicSlot(topics, name);
  if (slot === null || !name) return null;
  return (
    <span className="topic-chip" data-topic={slot}>
      <span className="topic-dot" aria-hidden="true" />
      {name}
    </span>
  );
}
