import { ApprenticePanel } from "./ApprenticePanel";
import { VisualPanel } from "./VisualPanel";

export function MainWorkspace() {
  return (
    <div className="main-workspace">
      <VisualPanel />
      <ApprenticePanel />
    </div>
  );
}
