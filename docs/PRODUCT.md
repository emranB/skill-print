# SkillPrint product

Short tour of what each screen is for. Pair with `videos/skillprint-product.mp4` (stills with copy) and `videos/skillprint-tech.mp4` (live navigation).

## Home

Teach a skill once. Coach every student after.

The landing page shows the product: a green student skeleton beside an orange teacher ghost, then Teach a Skill and Learn a Skill. Saved lessons sit below. Capture is chosen in the side panel: **Camera**, **Upload video**, or **Pose fixture**. Camera and upload are exclusive.

## Name the skill

A lesson is a named movement, not a hard-coded sport. Optional notes become guardrails: what a learner must never miss.

## Teach live with the apprentice

With the ElevenLabs apprentice and the camera, the voice session connects on the Ready screen. While recording, the mic stays closed so narration is not interrupted. About 8 seconds in, and then every so often (at most three times), the apprentice asks one short spoken question about why a shape matters, what to watch, or what must never happen, based on where the body just moved. The mic opens only for the answer, and the card on the video shows how many answers have been noted. Questions and answers are kept out of the narration transcript.

## Review the demonstration

After recording or upload, the engine finds repetitions. The expert can mark a cycle good or bad, download the video, then analyze. Upload skips camera calibration and runs transcription, pose reading, and apprentice study with on-screen progress.

## Capture review

The apprentice asks only what was not already said or shown: why a shape matters, what to watch, what must never happen. The expert answers in their own words. Those answers become part of the lesson. Questions asked aloud during a live recording appear first, tagged "Asked aloud while you recorded", with the spoken answer pre-filled so it can be corrected.

## Teach-back

The apprentice restates the lesson. The expert keeps, corrects, or removes each point. Only confirmed items are compiled into the saved skill.

## Lesson library

Saved lessons are stored as `lessons/<id>.json` in the project and copied into the browser. Geometry, expert meaning, and guardrails travel together. A deploy that includes that folder loads every saved lesson. Edit from Home, or Learn a Skill to practice.

## Learn calibration

The camera looks for a full body. Green joints are tracked. Red dashed bones and hollow rings are still missing. Continue unlocks after the whole body has been seen, and stays unlocked through brief dropouts.

## Predict, then move

Before the first attempt, the apprentice asks one question grounded in what the expert taught. The learner answers, then lines up with the teacher start shape.

## Ghost coaching

Orange is the teacher ghost (checkpoint geometry, scaled to the student). Green is the student skeleton, drawn on the live body. Coaching names the joint that is furthest off, and may add the expert's cue for that phase of the movement. Finish lesson shows reps, corrections, and the prediction.

## What the product is not

- The apprentice does not invent technique or decide geometric success.
- Mock mode is offline wording for tests and demos without credentials. It cannot classify real teaching.
- Pose fixture is a rehearsal input. Production teaching is camera or uploaded video.
