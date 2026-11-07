import { useState } from "react";

interface Props {
  initialName?: string;
  initialImportantThings?: string;
  initialKind?: "cycle" | "sequence";
  onContinue: (name: string, importantThings?: string, kind?: "cycle" | "sequence") => void;
  onCancel?: () => void;
}

export function SkillSetup({ initialName = "", initialImportantThings = "", initialKind = "cycle", onContinue, onCancel }: Props) {
  const [kind, setKind] = useState(initialKind);
  const [name, setName] = useState(initialName);
  const [importantThings, setImportantThings] = useState(initialImportantThings);

  return (
    <div className="skill-setup flow-panel">
      <h2>Name this skill</h2>
      <fieldset>
        <legend>Movement</legend>
        <label><input type="radio" name="movement-kind" checked={kind === "cycle"} onChange={() => setKind("cycle")} /> Repeating</label>
        <label><input type="radio" name="movement-kind" checked={kind === "sequence"} onChange={() => setKind("sequence")} /> One sequence</label>
      </fieldset>
      <label>
        Lesson name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Controlled movement"
        />
      </label>
      <label>
        Important things (optional)
        <textarea
          value={importantThings}
          onChange={(e) => setImportantThings(e.target.value)}
          placeholder="What must a learner never miss?"
          rows={3}
        />
      </label>
      <div className="home-actions">
        {onCancel ? (
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          className="primary"
          disabled={name.trim().length === 0}
          onClick={() => onContinue(name.trim(), importantThings.trim() || undefined, kind)}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
