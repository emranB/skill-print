import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { DebugBus } from "./DebugBus";
import { DebugEventRow } from "./DebugEventRow";
import type { DebugEvent } from "../../shared/debug/debug.types";

interface Props {
  onHide?: () => void;
}

/** Debug-level events stay in the exported trace but are never rendered. */
const shown = (event: DebugEvent) => event.level !== "debug";

export function DebugConsole({ onHide }: Props) {
  const [events, setEvents] = useState<DebugEvent[]>(() => DebugBus.getEvents().filter(shown));
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return DebugBus.subscribe((event) => {
      if (shown(event)) setEvents((prev) => [...prev, event]);
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [events.length]);

  const copyTrace = async () => {
    const text = DebugBus.exportTrace();
    await navigator.clipboard.writeText(text);
    DebugBus.emit({
      category: "APP",
      event: "DEBUG_TRACE_COPIED",
      message: `Copied ${DebugBus.getEvents().length} events`,
    });
  };

  const clear = () => {
    DebugBus.clear();
    setEvents([]);
  };

  return (
    <section className="debug-console" aria-label="Debug console">
      <header className="debug-console-header">
        <div className="debug-title">
          <h2>Debug / Logs</h2>
          <span className="log-count">{events.length}</span>
        </div>
        <div className="icon-toolbar" role="toolbar" aria-label="Log actions">
          <button type="button" className="icon-button" aria-label="Copy trace" title="Copy trace" onClick={() => void copyTrace()}>
            <Icon name="copy" />
          </button>
          <button type="button" className="icon-button" aria-label="Clear" title="Clear" onClick={clear}>
            <Icon name="clear" />
          </button>
          {onHide ? (
            <button type="button" className="icon-button" data-testid="logs-hide" aria-label="Hide logs" title="Hide logs" onClick={onHide}>
              <Icon name="hide" />
            </button>
          ) : null}
        </div>
      </header>
      <div className="debug-console-body">
        {events.length === 0 ? (
          <p className="debug-empty">No events yet.</p>
        ) : (
          events.map((event) => <DebugEventRow key={event.id} event={event} />)
        )}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}
