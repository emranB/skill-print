import { useApp } from "../app/AppContext";

export function LessonLibrary() {
  const { lessons, dispatch, goTo } = useApp();

  return (
    <div className="lesson-library flow-panel">
      <h2>Choose a lesson</h2>
      {lessons.length === 0 ? (
        <p className="muted">No lessons yet. Teach a skill first.</p>
      ) : (
        <ul className="lesson-pick-list">
          {lessons.map((lesson) => (
            <li key={lesson.id}>
              <button
                type="button"
                className="lesson-pick"
                onClick={() => {
                  dispatch({ type: "SET_SELECTED_LESSON", lessonId: lesson.id });
                  goTo("LEARN_CALIBRATION");
                }}
              >
                <strong>{lesson.name}</strong>
                <span className="muted">Updated {new Date(lesson.updatedAt).toLocaleDateString()}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="secondary" onClick={() => goTo("HOME")}>
        Back home
      </button>
    </div>
  );
}
