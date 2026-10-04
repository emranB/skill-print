interface Props {
  visible: boolean;
}

export function SuccessOverlay({ visible }: Props) {
  if (!visible) return null;
  return (
    <div className="success-overlay" role="status">
      <p className="success-text">SUCCESS</p>
    </div>
  );
}
