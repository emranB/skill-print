import { useState } from "react";

interface Props {
  initialName?: string;
  initialImportantThings?: string;
  onContinue: (name: string, importantThings?: string) => void;
  onCancel?: () => void;
}

export function SkillSetup({ initialName = "", initialImportantThings = "", onContinue, onCancel }: Props) {
  const [name, setName] = useState(initialName);
  const [importantThings, setImportantThings] = useState(initialImportantThings);

  return (
    <div className="skill-setup flow-panel">
      <h2>Name this skill</h2>
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
          onClick={() => onContinue(name.trim(), importantThings.trim() || undefined)}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
