import type { KnowledgeProvenance } from "../pose/pose.types";
import type { Lesson } from "./lesson.types";

interface Props {
  lesson: Lesson;
  onReplayEvidence?: (startMs: number, endMs: number) => void;
}

const SOURCE_LABEL: Record<KnowledgeProvenance["sourceClass"], string> = {
  EXPLICIT_TEACHING: "Narration",
  EXPERT_ANSWER: "Expert answer",
  CONFIRMED_TEACH_BACK: "Corrected in teach-back",
  OBSERVED: "Observed",
};

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function Provenance({
  provenance,
  statement,
  onReplayEvidence,
}: {
  provenance: KnowledgeProvenance;
  statement: string;
  onReplayEvidence?: (startMs: number, endMs: number) => void;
}) {
  const { startMs, endMs } = provenance;
  return (
    <div className="provenance">
      <p className="muted">
        <span className="tag" data-source={provenance.sourceClass}>
          {SOURCE_LABEL[provenance.sourceClass]}
        </span>
        {provenance.alignment ? <span className="tag">{provenance.alignment.toLowerCase()}</span> : null}
        {provenance.simulated ? <span className="tag warn">SIMULATED TEST RESPONSE</span> : null}
        {provenance.transcriptStartMs !== undefined ? ` said at ${seconds(provenance.transcriptStartMs)}` : null}
      </p>
      {provenance.transcriptText && provenance.transcriptText !== statement ? (
        <blockquote>"{provenance.transcriptText}"</blockquote>
      ) : null}
      {provenance.questionText ? (
        <p className="muted">
          Q: {provenance.questionText}
          {provenance.expertAnswer ? (
            <>
              <br />
              A: {provenance.expertAnswer}
            </>
          ) : null}
        </p>
      ) : null}
      {provenance.correctedFrom ? <p className="muted">Originally: {provenance.correctedFrom}</p> : null}
      {provenance.geometry?.length ? (
        <details className="geometry-details">
          <summary>Measured movement ({provenance.geometry.length})</summary>
          <ul className="geometry-notes">
            {provenance.geometry.map((g) => (
              <li key={g.feature}>{g.description.replace(/_/g, " ")}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {startMs !== undefined && endMs !== undefined && endMs > startMs ? (
        onReplayEvidence ? (
          <button type="button" onClick={() => onReplayEvidence(startMs, endMs)}>
            Replay evidence {seconds(startMs)} to {seconds(endMs)}
          </button>
        ) : (
          <span className="muted">
            Evidence {seconds(startMs)} to {seconds(endMs)} (source video is not stored with the lesson)
          </span>
        )
      ) : null}
    </div>
  );
}

/** Clickable Work Map: checkpoints, learned knowledge with provenance, guardrails, evidence. */
export function LessonMap({ lesson, onReplayEvidence }: Props) {
  const knowledge = [...lesson.knowledge].sort(
    (a, b) => (a.provenance.transcriptStartMs ?? a.provenance.startMs ?? 1e12) - (b.provenance.transcriptStartMs ?? b.provenance.startMs ?? 1e12),
  );
  return (
    <div className="lesson-map">
      <h2>Work Map</h2>
      <p className="muted">{lesson.name}</p>

      <section>
        <h3>Movement checkpoints</h3>
        <ol className="checkpoint-list">
          {lesson.canonicalMovement.checkpoints.map((cp) => (
            <li key={`${cp.index}-${cp.phase}-${cp.progress}`}>
              {cp.progress}%, {cp.phase}
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h3>Expert knowledge ({knowledge.length})</h3>
        {knowledge.length === 0 ? (
          <p className="muted">No knowledge items yet.</p>
        ) : (
          <ul className="knowledge-list">
            {knowledge.map((item) => (
              <li key={item.id} data-kind={item.kind}>
                <strong>{item.statement}</strong>
                {item.kind !== "unknown" ? <span className="muted"> ({item.kind})</span> : null}
                <Provenance provenance={item.provenance} statement={item.statement} onReplayEvidence={onReplayEvidence} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>Guardrails ({lesson.guardrails.length})</h3>
        {lesson.guardrails.length === 0 ? (
          <p className="muted">No guardrails. The expert has not named a mistake to avoid.</p>
        ) : (
          <ul className="knowledge-list">
            {lesson.guardrails.map((g) => (
              <li key={g.id}>
                <strong>{g.statement}</strong>
                <Provenance provenance={g.provenance} statement={g.statement} onReplayEvidence={onReplayEvidence} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>Demonstrations</h3>
        <ul>
          {lesson.demonstrations.map((d, i) => (
            <li key={d.id}>
              Repetition {i + 1}: {seconds(d.startMs)} to {seconds(d.endMs)}
              {d.classification !== "unknown" ? `, ${d.classification}` : ""}{" "}
              {onReplayEvidence ? (
                <button type="button" onClick={() => onReplayEvidence(d.startMs, d.endMs)}>
                  Play
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
