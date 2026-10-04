interface Props {
  label: string;
  tone?: "neutral" | "ok" | "warn" | "error";
}

export function StatusBadge({ label, tone = "neutral" }: Props) {
  return <span className={`status-badge tone-${tone}`}>{label}</span>;
}
