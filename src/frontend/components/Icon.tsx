type IconName = "copy" | "clear" | "hide" | "logs" | "camera" | "upload" | "fixture" | "on" | "off";

interface Props {
  name: IconName;
}

/** Small line icons for toolbars. They inherit the button color. */
export function Icon({ name }: Props) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {paths(name)}
    </svg>
  );
}

function paths(name: IconName) {
  if (name === "copy") {
    return (
      <>
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V5h10" />
      </>
    );
  }
  if (name === "clear") {
    return (
      <>
        <path d="M4 7h16" />
        <path d="M9 7V5h6v2" />
        <path d="M7 7l1 12h8l1-12" />
      </>
    );
  }
  if (name === "hide") {
    return <path d="M15 6l-6 6 6 6" />;
  }
  if (name === "logs") {
    return (
      <>
        <path d="M8 6h11" />
        <path d="M8 12h11" />
        <path d="M8 18h11" />
        <path d="M4 6h.01" />
        <path d="M4 12h.01" />
        <path d="M4 18h.01" />
      </>
    );
  }
  if (name === "camera") {
    return (
      <>
        <path d="M4 8h3l2-2h6l2 2h3v10H4V8z" />
        <circle cx="12" cy="13" r="3" />
      </>
    );
  }
  if (name === "upload") {
    return (
      <>
        <path d="M12 16V6" />
        <path d="M8 10l4-4 4 4" />
        <path d="M5 18h14" />
      </>
    );
  }
  if (name === "fixture") {
    return (
      <>
        <circle cx="12" cy="5" r="1.6" />
        <path d="M12 7v5" />
        <path d="M8 10h8" />
        <path d="M9 20l3-8 3 8" />
      </>
    );
  }
  if (name === "on") {
    return (
      <>
        <path d="M12 3v6" />
        <path d="M7 7a7 7 0 1 0 10 0" />
      </>
    );
  }
  return (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M9 9l6 6" />
    </>
  );
}
