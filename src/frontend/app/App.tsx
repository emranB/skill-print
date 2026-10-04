import { useState } from "react";
import { AppProvider } from "./AppContext";
import { ApprenticeProvider } from "../apprentice/ApprenticeProvider";
import { MainWorkspace } from "../components/MainWorkspace";
import { Icon } from "../components/Icon";
import { DebugConsole } from "../debug/DebugConsole";

function logsStartOpen(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(min-width: 961px)").matches;
}

export function App() {
  const [logsOpen, setLogsOpen] = useState(logsStartOpen);

  return (
    <AppProvider>
      <ApprenticeProvider>
        <div className={`app-shell ${logsOpen ? "logs-open" : "logs-closed"}`}>
          {logsOpen ? (
            <button
              type="button"
              className="logs-backdrop"
              aria-label="Hide logs"
              onClick={() => setLogsOpen(false)}
            />
          ) : null}
          {!logsOpen ? (
            <button
              type="button"
              className="logs-edge-toggle"
              data-testid="logs-open"
              aria-label="Show logs"
              onClick={() => setLogsOpen(true)}
            >
              <Icon name="logs" />
              <span>Logs</span>
            </button>
          ) : null}
          <div className="logs-column" data-testid="logs-panel" aria-hidden={!logsOpen}>
            <DebugConsole onHide={() => setLogsOpen(false)} />
          </div>
          <MainWorkspace />
        </div>
      </ApprenticeProvider>
    </AppProvider>
  );
}
