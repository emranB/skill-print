const COMPANY_URL = "https://bluethumbtechnologies.ca";

/** Small parent-company credit. */
export function CompanyMark() {
  return (
    <a className="company-mark" href={COMPANY_URL} target="_blank" rel="noopener noreferrer">
      <img src="/images/bt-logo.png" alt="" />
      Bluethumb Technologies
    </a>
  );
}
