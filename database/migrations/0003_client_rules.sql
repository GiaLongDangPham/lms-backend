-- Client Log 18-20; L04/L05/L14/L20. Preserve applied migrations 0001/0002.
ALTER TABLE classes ADD COLUMN course_code text;
ALTER TABLE classes ADD COLUMN description text;
UPDATE classes SET course_code = 'DEMO-COURSE-A'
  WHERE id = '20000000-0000-4000-8000-000000000001' AND code = 'LMS-DEMO-A';
UPDATE classes SET course_code = 'DEMO-COURSE-B'
  WHERE id = '20000000-0000-4000-8000-000000000002' AND code = 'LMS-DEMO-B';
UPDATE classes c SET course_code = m.value
  FROM jsonb_each_text(COALESCE(NULLIF(current_setting('lms.class_course_mapping', true), ''), '{}')::jsonb) m
  WHERE c.id::text = m.key;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM classes WHERE course_code IS NULL) THEN
    RAISE EXCEPTION 'Existing non-demo classes need CLASS_COURSE_MAPPING (JSON: class UUID to course code) before migration';
  END IF;
END $$;
ALTER TABLE classes ALTER COLUMN course_code SET NOT NULL;
ALTER TABLE classes ADD CONSTRAINT classes_course_code_check
  CHECK (course_code = upper(btrim(course_code)) AND course_code <> '' AND length(course_code) <= 50);
ALTER TABLE classes DROP CONSTRAINT classes_code_term_key;
ALTER TABLE classes ADD CONSTRAINT classes_course_code_code_term_key UNIQUE(course_code, code, term);
ALTER TABLE submission_versions ADD COLUMN note text CHECK (length(note) <= 2000);
ALTER TABLE assignments ADD COLUMN results_published_at timestamptz;

ALTER TABLE grades ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE grades ADD COLUMN assignment_id uuid REFERENCES assignments(id) ON DELETE RESTRICT;
ALTER TABLE grades ADD COLUMN enrollment_id uuid REFERENCES enrollments(id) ON DELETE RESTRICT;
ALTER TABLE grades ADD COLUMN source text NOT NULL DEFAULT 'MANUAL'
  CHECK (source IN ('MANUAL', 'AUTO_ZERO_NO_SUBMISSION'));
ALTER TABLE grades ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1);
UPDATE grades g SET assignment_id = s.assignment_id, enrollment_id = s.enrollment_id
  FROM submissions s WHERE s.id = g.submission_id;
ALTER TABLE grades ALTER COLUMN assignment_id SET NOT NULL;
ALTER TABLE grades ALTER COLUMN enrollment_id SET NOT NULL;
ALTER TABLE grades DROP CONSTRAINT grades_pkey;
ALTER TABLE grades ADD PRIMARY KEY(id);
ALTER TABLE grades ALTER COLUMN submission_id DROP NOT NULL;
ALTER TABLE grades ALTER COLUMN graded_version_number DROP NOT NULL;
ALTER TABLE grades ADD UNIQUE(submission_id);
ALTER TABLE grades ADD UNIQUE(assignment_id, enrollment_id);
ALTER TABLE grades ADD CONSTRAINT grades_submission_pair CHECK (
  (submission_id IS NULL) = (graded_version_number IS NULL));
ALTER TABLE grades ADD CONSTRAINT grades_automatic_zero CHECK (
  source <> 'AUTO_ZERO_NO_SUBMISSION' OR (score = 0 AND submission_id IS NULL AND status = 'PUBLISHED'));
ALTER TABLE grades ADD CONSTRAINT grades_no_submission_published CHECK (submission_id IS NOT NULL OR status = 'PUBLISHED');
CREATE INDEX grades_enrollment_idx ON grades(enrollment_id);

CREATE TABLE grade_history (
  grade_id uuid NOT NULL REFERENCES grades(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version >= 1),
  score numeric NOT NULL CHECK (score >= 0 AND score < 'Infinity'::numeric),
  feedback text,
  status text NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED')),
  source text NOT NULL CHECK (source IN ('MANUAL', 'AUTO_ZERO_NO_SUBMISSION')),
  submission_id uuid REFERENCES submissions(id) ON DELETE RESTRICT,
  graded_version_number integer,
  changed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL,
  PRIMARY KEY(grade_id, version),
  FOREIGN KEY(submission_id, graded_version_number)
    REFERENCES submission_versions(submission_id, version_number) ON DELETE RESTRICT
);
INSERT INTO grade_history(grade_id,version,score,feedback,status,source,submission_id,graded_version_number,changed_by,changed_at)
  SELECT id,revision,score,feedback,status,source,submission_id,graded_version_number,
    COALESCE(published_by,graded_by),COALESCE(published_at,graded_at) FROM grades;
-- Do not infer assignment-wide publication from legacy per-student publication.

CREATE FUNCTION validate_grade_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assignment_class uuid; enrollment_class uuid; maximum numeric; s submissions; latest integer;
BEGIN
  SELECT class_id,max_score INTO assignment_class,maximum FROM assignments WHERE id=NEW.assignment_id FOR UPDATE;
  SELECT class_id INTO enrollment_class FROM enrollments WHERE id=NEW.enrollment_id FOR SHARE;
  IF assignment_class IS NULL OR assignment_class IS DISTINCT FROM enrollment_class THEN
    RAISE EXCEPTION 'Grade assignment and enrollment must belong to the same class' USING ERRCODE='23514';
  END IF;
  IF NEW.score > maximum THEN RAISE EXCEPTION 'Grade exceeds maximum score' USING ERRCODE='23514'; END IF;
  IF NEW.submission_id IS NOT NULL THEN
    SELECT * INTO s FROM submissions WHERE id=NEW.submission_id;
    IF s.assignment_id IS DISTINCT FROM NEW.assignment_id OR s.enrollment_id IS DISTINCT FROM NEW.enrollment_id THEN
      RAISE EXCEPTION 'Grade does not match submission owner or assignment' USING ERRCODE='23514';
    END IF;
    SELECT max(version_number) INTO latest FROM submission_versions WHERE submission_id=NEW.submission_id;
    -- 0001 allowed a later submission after grading. Keep that grade's original
    -- version usable for publication/correction without rewriting its history.
    IF NEW.graded_version_number IS DISTINCT FROM latest AND NOT EXISTS (
      SELECT 1 FROM grades WHERE submission_id=NEW.submission_id
        AND graded_version_number=NEW.graded_version_number) THEN
      RAISE EXCEPTION 'Grade must reference the current submission version' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF (NEW.assignment_id,NEW.enrollment_id,NEW.submission_id,NEW.graded_version_number)
       IS DISTINCT FROM (OLD.assignment_id,OLD.enrollment_id,OLD.submission_id,OLD.graded_version_number) THEN
      RAISE EXCEPTION 'Grade identity cannot change' USING ERRCODE='23514';
    END IF;
    IF OLD.status='PUBLISHED' AND NEW.status <> 'PUBLISHED' THEN
      RAISE EXCEPTION 'Published result cannot return to Draft' USING ERRCODE='23514';
    END IF;
    IF (NEW.score,NEW.feedback,NEW.status,NEW.source,NEW.graded_by,NEW.published_by,NEW.published_at)
      IS DISTINCT FROM (OLD.score,OLD.feedback,OLD.status,OLD.source,OLD.graded_by,OLD.published_by,OLD.published_at) THEN
      NEW.revision := OLD.revision+1;
    ELSE NEW.revision := OLD.revision;
    END IF;
  ELSE NEW.revision := 1;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER grade_score ON grades;
CREATE TRIGGER grade_result BEFORE INSERT OR UPDATE ON grades FOR EACH ROW EXECUTE FUNCTION validate_grade_result();

CREATE FUNCTION append_grade_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor uuid;
BEGIN
  IF TG_OP='INSERT' OR NEW.revision <> OLD.revision THEN
    actor := CASE WHEN TG_OP='UPDATE' AND OLD.status='DRAFT' AND NEW.status='PUBLISHED'
      THEN NEW.published_by ELSE NEW.graded_by END;
    INSERT INTO grade_history VALUES (NEW.id,NEW.revision,NEW.score,NEW.feedback,NEW.status,NEW.source,
      NEW.submission_id,NEW.graded_version_number,actor,clock_timestamp());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER grade_history_append AFTER INSERT OR UPDATE ON grades FOR EACH ROW EXECUTE FUNCTION append_grade_history();
CREATE FUNCTION protect_grade_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Grade history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER grade_history_immutable BEFORE UPDATE OR DELETE ON grade_history
  FOR EACH ROW EXECUTE FUNCTION protect_grade_history();

CREATE FUNCTION lock_submission_after_grading() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a uuid; e uuid; published timestamptz;
BEGIN
  IF EXISTS(SELECT 1 FROM submission_versions WHERE submission_id=NEW.submission_id AND version_number=NEW.version_number) THEN
    RETURN NEW; -- Preserve INSERT ... ON CONFLICT DO NOTHING on an existing immutable version.
  END IF;
  SELECT assignment_id,enrollment_id INTO a,e FROM submissions WHERE id=NEW.submission_id;
  SELECT results_published_at INTO published FROM assignments WHERE id=a FOR UPDATE;
  IF published IS NOT NULL OR EXISTS(SELECT 1 FROM grades WHERE assignment_id=a AND enrollment_id=e) THEN
    RAISE EXCEPTION 'GRADE_LOCKS_SUBMISSION' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER submission_grade_lock BEFORE INSERT ON submission_versions
  FOR EACH ROW EXECUTE FUNCTION lock_submission_after_grading();

CREATE OR REPLACE FUNCTION check_assignment_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.class_id IS DISTINCT FROM OLD.class_id AND (
    EXISTS(SELECT 1 FROM submissions WHERE assignment_id=OLD.id) OR EXISTS(SELECT 1 FROM grades WHERE assignment_id=OLD.id)) THEN
    RAISE EXCEPTION 'Assignment with results cannot change class' USING ERRCODE='23514';
  END IF;
  IF NEW.max_score IS DISTINCT FROM OLD.max_score AND EXISTS(SELECT 1 FROM grades WHERE assignment_id=OLD.id AND score > NEW.max_score) THEN
    RAISE EXCEPTION 'Maximum score cannot be lower than an existing grade' USING ERRCODE='23514';
  END IF;
  IF OLD.results_published_at IS NOT NULL AND NEW.results_published_at IS DISTINCT FROM OLD.results_published_at THEN
    RAISE EXCEPTION 'Publication cannot be undone' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION check_membership_role() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE member_role text;
BEGIN
  IF TG_TABLE_NAME='class_teachers' THEN
    SELECT role INTO member_role FROM users WHERE id=NEW.teacher_id FOR SHARE;
    IF member_role IS DISTINCT FROM 'TEACHER' THEN RAISE EXCEPTION 'Only a teacher can be assigned' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT role INTO member_role FROM users WHERE id=NEW.student_id FOR SHARE;
    IF member_role IS DISTINCT FROM 'STUDENT' THEN RAISE EXCEPTION 'Only a student can be enrolled' USING ERRCODE='23514'; END IF;
    IF TG_OP='UPDATE' AND (NEW.class_id,NEW.student_id) IS DISTINCT FROM (OLD.class_id,OLD.student_id) AND (
      EXISTS(SELECT 1 FROM submissions WHERE enrollment_id=OLD.id) OR EXISTS(SELECT 1 FROM grades WHERE enrollment_id=OLD.id)) THEN
      RAISE EXCEPTION 'Enrollment with results cannot change identity' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
