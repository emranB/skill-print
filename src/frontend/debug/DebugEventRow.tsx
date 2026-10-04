import type { DebugEvent } from "../../shared/debug/debug.types";
import { formatWallClock } from "../../shared/utils/time";

interface Props {
  event: DebugEvent;
}

export function DebugEventRow({ event }: Props) {
  const session =
    event.sessionTimeMs === undefined ? "" : ` t=${Math.round(event.sessionTimeMs)}ms`;
  return (
    <div className={`debug-row level-${event.level}`}>
      <span className="debug-time">{formatWallClock(event.wallTimeIso)}</span>
      <span className="debug-cat">{event.category}</span>
      <span className="debug-event">
        {event.event}
        {session}
      </span>
      {event.message ? <span className="debug-msg">{event.message}</span> : null}
      {event.data !== undefined ? (
        <pre className="debug-data">{JSON.stringify(event.data, null, 2)}</pre>
      ) : null}
    </div>
  );
}
