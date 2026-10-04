import { useState } from "react";
import type { TeachBackItem } from "../lesson/TeachBackItems";

interface Props {
  summary: string;
  items: TeachBackItem[];
  onChange: (items: TeachBackItem[]) => void;
  onConfirm: () => void;
}

const SOURCE_LABEL: Record<string, string> = {
  EXPLICIT_TEACHING: "From your narration",
  EXPERT_ANSWER: "From your answer",
  CONFIRMED_TEACH_BACK: "Corrected by you",
  OBSERVED: "Observed",
};

/** The apprentice reads back what it learned; the expert keeps, corrects, or removes each item. */
export function TeachBackReview({ summary, items, onChange, onConfirm }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const update = (id: string, patch: Partial<TeachBackItem>) =>
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const reviewed = items.every((i) => i.status !== "pending");
  const kept = items.filter((i) => i.status === "confirmed" || i.status === "corrected").length;

  return (
    <div className="debrief flow-panel teach-back">
      <h2>Teach-back</h2>
      <p className="apprentice-message teach-back-summary" data-testid="teach-back-summary">
        {summary}
      </p>
      <p className="muted">Keep, correct, or remove each point before it goes into the lesson.</p>
      <div className="home-actions">
        <button
          type="button"
          className="secondary"
          onClick={() =>
            onChange(items.map((i) => (i.status === "pending" ? { ...i, status: "confirmed" } : i)))
          }
        >
          Keep all remaining
        </button>
      </div>
      <ol className="teach-back-items">
        {items.map((item) => {
          const shown = item.correctedText ?? item.text;
          const source = item.provenance.transcriptText ?? item.provenance.expertAnswer;
          return (
            <li key={item.id} data-status={item.status}>
              <p>
                <strong>{shown}</strong>
                {item.kind !== "unknown" ? <span className="muted"> ({item.kind})</span> : null}
              </p>
              <p className="muted">
                {SOURCE_LABEL[item.provenance.sourceClass] ?? item.provenance.sourceClass}
                {source && source !== shown ? `: "${source}"` : ""}
                {item.provenance.alignment ? `, ${item.provenance.alignment.toLowerCase()} with the movement` : ""}
                {item.provenance.simulated ? ", SIMULATED TEST RESPONSE" : ""}
              </p>
              {editing === item.id ? (
                <div>
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} />
                  <button
                    type="button"
                    className="primary"
                    disabled={!draft.trim()}
                    onClick={() => {
                      update(item.id, { status: "corrected", correctedText: draft.trim() });
                      setEditing(null);
                    }}
                  >
                    Save correction
                  </button>
                </div>
              ) : (
                <div className="home-actions">
                  <button type="button" onClick={() => update(item.id, { status: "confirmed", correctedText: undefined })}>
                    {item.status === "confirmed" ? "Kept" : "Keep"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(item.correctedText ?? item.text);
                      setEditing(item.id);
                    }}
                  >
                    Correct
                  </button>
                  <button type="button" onClick={() => update(item.id, { status: "rejected" })}>
                    {item.status === "rejected" ? "Removed" : "Remove"}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <button type="button" className="primary" disabled={!reviewed || kept === 0} onClick={onConfirm}>
        Confirm teach-back and review lesson
      </button>
    </div>
  );
}
