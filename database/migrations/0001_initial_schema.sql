-- D1 initial schema. Business decisions Q04-Q10 remain subject to CP1/CP2 review.
-- Apply through db:migrate; its runner supplies the transaction.

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_code text NOT NULL UNIQUE CHECK (school_code <> '' AND school_code = upper(btrim(school_code))),
  full_name text NOT NULL CHECK (btrim(full_name) <> ''),
  email text CHECK (email IS NULL OR btrim(email) <> ''),
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('ADMIN', 'TEACHER', 'STUDENT')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL CHECK (btrim(code) <> ''),
  name text NOT NULL CHECK (btrim(name) <> ''),
  term text NOT NULL CHECK (btrim(term) <> ''),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, term)
);

CREATE TABLE class_teachers (
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  teacher_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (class_id, teacher_id)
);
CREATE INDEX class_teachers_teacher_idx ON class_teachers(teacher_id);

CREATE TABLE enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  enrolled_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, student_id)
);
CREATE INDEX enrollments_student_idx ON enrollments(student_id);

CREATE TABLE materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (btrim(title) <> ''),
  description text,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX materials_class_created_idx ON materials(class_id, created_at);

CREATE TABLE assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (btrim(title) <> ''),
  description text,
  deadline_at timestamptz NOT NULL,
  max_score numeric NOT NULL CHECK (max_score > 0 AND max_score < 'Infinity'::numeric),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assignments_class_deadline_idx ON assignments(class_id, deadline_at);

CREATE TABLE submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE RESTRICT,
  enrollment_id uuid NOT NULL REFERENCES enrollments(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, enrollment_id)
);
CREATE INDEX submissions_enrollment_idx ON submissions(enrollment_id);

CREATE TABLE submission_versions (
  submission_id uuid NOT NULL REFERENCES submissions(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number >= 1),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  deadline_at_submission timestamptz NOT NULL,
  PRIMARY KEY (submission_id, version_number)
);

CREATE TABLE grades (
  submission_id uuid PRIMARY KEY REFERENCES submissions(id) ON DELETE RESTRICT,
  graded_version_number integer NOT NULL,
  score numeric NOT NULL CHECK (score >= 0 AND score < 'Infinity'::numeric),
  feedback text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED')),
  graded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  graded_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  published_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (submission_id, graded_version_number)
    REFERENCES submission_versions(submission_id, version_number) ON DELETE RESTRICT,
  CHECK (
    (status = 'DRAFT' AND published_by IS NULL AND published_at IS NULL) OR
    (status = 'PUBLISHED' AND published_by IS NOT NULL AND published_at IS NOT NULL)
  )
);

CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_provider text NOT NULL CHECK (btrim(storage_provider) <> ''),
  storage_container text NOT NULL CHECK (btrim(storage_container) <> ''),
  object_key text NOT NULL CHECK (btrim(object_key) <> ''),
  original_name text NOT NULL CHECK (btrim(original_name) <> ''),
  mime_type text NOT NULL CHECK (btrim(mime_type) <> ''),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  uploaded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (storage_provider, storage_container, object_key)
);

CREATE TABLE material_files (
  material_id uuid NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  file_id uuid NOT NULL REFERENCES files(id) ON DELETE RESTRICT,
  PRIMARY KEY (material_id, file_id)
);
CREATE INDEX material_files_file_idx ON material_files(file_id);

CREATE TABLE assignment_files (
  assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE RESTRICT,
  file_id uuid NOT NULL REFERENCES files(id) ON DELETE RESTRICT,
  PRIMARY KEY (assignment_id, file_id)
);
CREATE INDEX assignment_files_file_idx ON assignment_files(file_id);

CREATE TABLE submission_files (
  submission_id uuid NOT NULL,
  version_number integer NOT NULL,
  file_id uuid NOT NULL REFERENCES files(id) ON DELETE RESTRICT,
  PRIMARY KEY (submission_id, version_number, file_id),
  FOREIGN KEY (submission_id, version_number)
    REFERENCES submission_versions(submission_id, version_number) ON DELETE RESTRICT
);
CREATE INDEX submission_files_file_idx ON submission_files(file_id);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assignment_id uuid REFERENCES assignments(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('ASSIGNMENT_CREATED', 'DEADLINE_REMINDER', 'GRADE_PUBLISHED')),
  title text NOT NULL CHECK (btrim(title) <> ''),
  body text NOT NULL,
  deduplication_key text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipient_id, deduplication_key)
);
CREATE INDEX notifications_recipient_created_idx ON notifications(recipient_id, created_at);

CREATE TABLE comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assignment_id uuid REFERENCES assignments(id) ON DELETE RESTRICT,
  submission_id uuid REFERENCES submissions(id) ON DELETE RESTRICT,
  body text NOT NULL CHECK (btrim(body) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((assignment_id IS NOT NULL) <> (submission_id IS NOT NULL))
);
CREATE INDEX comments_assignment_created_idx ON comments(assignment_id, created_at);
CREATE INDEX comments_submission_created_idx ON comments(submission_id, created_at);

CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER classes_updated BEFORE UPDATE ON classes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER enrollments_updated BEFORE UPDATE ON enrollments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER materials_updated BEFORE UPDATE ON materials FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER assignments_updated BEFORE UPDATE ON assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER grades_updated BEFORE UPDATE ON grades FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER comments_updated BEFORE UPDATE ON comments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE FUNCTION check_membership_role() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE member_role text;
BEGIN
  IF TG_TABLE_NAME = 'class_teachers' THEN
    SELECT role INTO member_role FROM users WHERE id = NEW.teacher_id FOR SHARE;
    IF member_role IS DISTINCT FROM 'TEACHER' THEN
      RAISE EXCEPTION 'Only a teacher can be assigned to a class' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT role INTO member_role FROM users WHERE id = NEW.student_id FOR SHARE;
    IF member_role IS DISTINCT FROM 'STUDENT' THEN
      RAISE EXCEPTION 'Only a student can be enrolled in a class' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND
       (NEW.class_id IS DISTINCT FROM OLD.class_id OR NEW.student_id IS DISTINCT FROM OLD.student_id) AND
       EXISTS (SELECT 1 FROM submissions WHERE enrollment_id = OLD.id) THEN
      RAISE EXCEPTION 'An enrollment with submissions cannot change class or student' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER teacher_role BEFORE INSERT OR UPDATE ON class_teachers
  FOR EACH ROW EXECUTE FUNCTION check_membership_role();
CREATE TRIGGER student_role BEFORE INSERT OR UPDATE ON enrollments
  FOR EACH ROW EXECUTE FUNCTION check_membership_role();

CREATE FUNCTION check_user_role_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role AND (
    EXISTS (SELECT 1 FROM class_teachers WHERE teacher_id = OLD.id) OR
    EXISTS (SELECT 1 FROM enrollments WHERE student_id = OLD.id)
  ) THEN
    RAISE EXCEPTION 'Remove class memberships before changing user role' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER user_role_change BEFORE UPDATE OF role ON users
  FOR EACH ROW EXECUTE FUNCTION check_user_role_change();

CREATE FUNCTION check_submission_class() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assignment_class uuid; enrollment_class uuid;
BEGIN
  SELECT class_id INTO assignment_class FROM assignments WHERE id = NEW.assignment_id FOR SHARE;
  SELECT class_id INTO enrollment_class FROM enrollments WHERE id = NEW.enrollment_id FOR SHARE;
  IF assignment_class IS NULL OR enrollment_class IS NULL OR assignment_class <> enrollment_class THEN
    RAISE EXCEPTION 'Submission assignment and enrollment must belong to the same class' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND
     (NEW.assignment_id IS DISTINCT FROM OLD.assignment_id OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id) THEN
    RAISE EXCEPTION 'Submission identity cannot be changed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER submission_class BEFORE INSERT OR UPDATE ON submissions
  FOR EACH ROW EXECUTE FUNCTION check_submission_class();

CREATE FUNCTION check_assignment_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.class_id IS DISTINCT FROM OLD.class_id AND EXISTS (SELECT 1 FROM submissions WHERE assignment_id = OLD.id) THEN
    RAISE EXCEPTION 'An assignment with submissions cannot change class' USING ERRCODE = '23514';
  END IF;
  IF NEW.max_score IS DISTINCT FROM OLD.max_score AND EXISTS (
    SELECT 1 FROM grades g JOIN submissions s ON s.id = g.submission_id
    WHERE s.assignment_id = OLD.id AND g.score > NEW.max_score
  ) THEN
    RAISE EXCEPTION 'Maximum score cannot be lower than an existing grade' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER assignment_change BEFORE UPDATE ON assignments
  FOR EACH ROW EXECUTE FUNCTION check_assignment_change();

CREATE FUNCTION check_grade_score() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE maximum numeric;
BEGIN
  SELECT a.max_score INTO maximum FROM assignments a
    JOIN submissions s ON s.assignment_id = a.id
    WHERE s.id = NEW.submission_id FOR SHARE OF a;
  IF maximum IS NULL OR NEW.score > maximum THEN
    RAISE EXCEPTION 'Grade must not exceed assignment maximum score' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER grade_score BEFORE INSERT OR UPDATE ON grades
  FOR EACH ROW EXECUTE FUNCTION check_grade_score();

-- Historical rows cannot be rewritten. Deletion policies remain under Q10 review;
-- referenced records are protected by RESTRICT, not automatic cascading.
CREATE FUNCTION reject_version_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Submission versions are immutable; create a new version' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER version_immutable BEFORE UPDATE ON submission_versions
  FOR EACH ROW EXECUTE FUNCTION reject_version_update();
