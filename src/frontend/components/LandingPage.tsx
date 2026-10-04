import { useApp } from "../app/AppContext";
import { SkeletonScene } from "./SkeletonScene";

const STEPS = [
  {
    kicker: "01",
    title: "Teach by doing",
    body: "Record on camera or upload a demonstration. Your skeleton is drawn on the body while you move.",
  },
  {
    kicker: "02",
    title: "Confirm the lesson",
    body: "The apprentice asks a few short questions, some of them out loud while you record. You keep, correct, or remove each point.",
  },
  {
    kicker: "03",
    title: "Coach with a ghost",
    body: "Orange is the teacher. Green is the student. Coaching names the body part that is furthest off.",
  },
] as const;

/** Home screen: product story, skeleton scene, and the two main actions. */
export function LandingPage() {
  const { lessons, inputSource, uploadFile, goTo, dispatch } = useApp();

  const sourceLine =
    inputSource === "upload"
      ? uploadFile
        ? `Teaching from ${uploadFile.name}. Use this video in the side panel, or teach a skill.`
        : "Upload video is selected. Choose a file in the side panel."
      : inputSource === "fixture"
        ? "Pose fixture is selected. Recorded poses stand in for the camera."
        : "Camera is selected. Teach records you live. Learn coaches you live.";

  return (
    <div className="landing">
      <section className="landing-hero">
        <div className="landing-copy">
          <p className="brand">SkillPrint</p>
          <p className="landing-kicker">Physical skill apprentice</p>
          <h1>Teach a skill once. Coach every student after.</h1>
          <p className="landing-lead">
            You demonstrate the movement. SkillPrint measures the body and keeps your words. A learner
            then trains against a ghost of you.
          </p>
          <div className="home-actions">
            <button type="button" className="primary" onClick={() => goTo("TEACH_CALIBRATION")}>
              Teach a Skill
            </button>
            <button type="button" className="secondary" onClick={() => goTo("LEARN_LIBRARY")}>
              Learn a Skill
            </button>
          </div>
          <ul className="landing-legend">
            <li>
              <span className="swatch swatch-student" />
              Student skeleton
            </li>
            <li>
              <span className="swatch swatch-ghost" />
              Teacher ghost
            </li>
          </ul>
        </div>
        <figure className="landing-stage">
          <SkeletonScene />
          <figcaption>Green follows the body. Orange is the saved teacher, scaled to the student.</figcaption>
        </figure>
      </section>

      <section className="landing-grid" aria-label="How SkillPrint works">
        {STEPS.map((step) => (
          <article key={step.kicker} className="landing-card">
            <p className="landing-kicker">{step.kicker}</p>
            <h2>{step.title}</h2>
            <p>{step.body}</p>
          </article>
        ))}
      </section>

      <section className="lesson-list landing-card">
        <div className="section-head">
          <h2>Your lessons</h2>
          <p className="muted">{sourceLine}</p>
        </div>
        {lessons.length === 0 ? (
          <p className="muted">No saved lessons yet. Teach a skill to create the first one.</p>
        ) : (
          <ul>
            {lessons.map((lesson) => (
              <li key={lesson.id}>
                <span>{lesson.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    dispatch({ type: "SET_SELECTED_LESSON", lessonId: lesson.id });
                    goTo("TEACH_EDITING");
                  }}
                >
                  Edit
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
