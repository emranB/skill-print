interface Props {
  name: string;
  updatedAt: string;
  onEdit?: () => void;
  onSelect?: () => void;
}

export function LessonCard({ name, updatedAt, onEdit, onSelect }: Props) {
  return (
    <div className="lesson-card">
      <div>
        <strong>{name}</strong>
        <p className="muted">{new Date(updatedAt).toLocaleString()}</p>
      </div>
      <div className="home-actions">
        {onSelect ? (
          <button type="button" className="primary" onClick={onSelect}>
            Learn
          </button>
        ) : null}
        {onEdit ? (
          <button type="button" onClick={onEdit}>
            Edit
          </button>
        ) : null}
      </div>
    </div>
  );
}
