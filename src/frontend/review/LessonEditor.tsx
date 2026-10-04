import { useEffect, useState } from "react";
import { useApp } from "../app/AppContext";
import { LessonRepository } from "../storage/LessonRepository";
import type { Lesson } from "../lesson/lesson.types";

export function LessonEditor() {
  const { selectedLessonId, goTo, refreshLessons } = useApp();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [name, setName] = useState("");
  const [importantThings, setImportantThings] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!selectedLessonId) {
        setLoading(false);
        return;
      }
      const found = await LessonRepository.get(selectedLessonId);
      if (found) {
        setLesson(found);
        setName(found.name);
        setImportantThings(found.importantThings ?? "");
      }
      setLoading(false);
    })();
  }, [selectedLessonId]);

  if (loading) {
    return <p className="muted">Loading lesson...</p>;
  }

  if (!lesson) {
    return (
      <div className="flow-panel">
        <p className="error-text">Lesson not found.</p>
        <button type="button" onClick={() => goTo("HOME")}>
          Home
        </button>
      </div>
    );
  }

  const save = async () => {
    setSaving(true);
    const updated: Lesson = {
      ...lesson,
      name: name.trim() || lesson.name,
      importantThings: importantThings.trim() || undefined,
      updatedAt: new Date().toISOString(),
    };
    await LessonRepository.save(updated);
    await refreshLessons();
    setSaving(false);
    goTo("HOME");
  };

  return (
    <div className="lesson-editor flow-panel">
      <h2>Edit lesson</h2>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Guidance / important things
        <textarea
          value={importantThings}
          onChange={(e) => setImportantThings(e.target.value)}
          rows={4}
        />
      </label>
      <div className="home-actions">
        <button type="button" className="secondary" onClick={() => goTo("HOME")}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={saving} onClick={() => void save()}>
          Save
        </button>
      </div>
    </div>
  );
}
