-- B3 assignment/submission invariants approved on 24/10/2026.
-- Keep 0001-0003 immutable; the migration runner supplies the transaction.

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM assignments WHERE max_score <> round(max_score, 2)
    UNION ALL
    SELECT 1 FROM grades WHERE score <> round(score, 2)
    UNION ALL
    SELECT 1 FROM grade_history WHERE score <> round(score, 2)
  ) THEN
    RAISE EXCEPTION 'Existing scores must have at most two decimal places before B3 migration';
  END IF;
END $$;

ALTER TABLE assignments ALTER COLUMN max_score TYPE numeric(12,2);
ALTER TABLE grades ALTER COLUMN score TYPE numeric(12,2);
ALTER TABLE grade_history ALTER COLUMN score TYPE numeric(12,2);

ALTER TABLE files ADD COLUMN lifecycle_status text;
ALTER TABLE files ADD COLUMN attached_at timestamptz;
ALTER TABLE files ADD COLUMN delete_attempted_at timestamptz;
UPDATE files f SET lifecycle_status = CASE WHEN
  EXISTS (SELECT 1 FROM material_files mf WHERE mf.file_id = f.id) OR
  EXISTS (SELECT 1 FROM assignment_files af WHERE af.file_id = f.id) OR
  EXISTS (SELECT 1 FROM submission_files sf WHERE sf.file_id = f.id)
  THEN 'ATTACHED' ELSE 'PENDING' END,
  attached_at = CASE WHEN
    EXISTS (SELECT 1 FROM material_files mf WHERE mf.file_id = f.id) OR
    EXISTS (SELECT 1 FROM assignment_files af WHERE af.file_id = f.id) OR
    EXISTS (SELECT 1 FROM submission_files sf WHERE sf.file_id = f.id)
    THEN created_at ELSE NULL END;
ALTER TABLE files ALTER COLUMN lifecycle_status SET NOT NULL;
ALTER TABLE files ALTER COLUMN lifecycle_status SET DEFAULT 'PENDING';
ALTER TABLE files ADD CONSTRAINT files_lifecycle_status_check
  CHECK (lifecycle_status IN ('PENDING', 'ATTACHED', 'DELETE_PENDING'));
ALTER TABLE files ADD CONSTRAINT files_max_size_check CHECK (size_bytes <= 26214400);
ALTER TABLE files ADD CONSTRAINT files_attached_at_check CHECK (
  (lifecycle_status = 'ATTACHED' AND attached_at IS NOT NULL) OR
  (lifecycle_status <> 'ATTACHED' AND attached_at IS NULL));
CREATE INDEX files_pending_cleanup_idx ON files(created_at)
  WHERE lifecycle_status = 'PENDING';
CREATE INDEX files_delete_retry_idx ON files(delete_attempted_at)
  WHERE lifecycle_status = 'DELETE_PENDING';

CREATE UNIQUE INDEX material_files_one_parent_idx ON material_files(file_id);
CREATE UNIQUE INDEX assignment_files_one_parent_idx ON assignment_files(file_id);
CREATE UNIQUE INDEX submission_files_one_parent_idx ON submission_files(file_id);

CREATE FUNCTION prevent_file_reuse() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_status text;
BEGIN
  IF TG_TABLE_NAME = 'material_files' THEN
    IF EXISTS (SELECT 1 FROM material_files
      WHERE material_id=NEW.material_id AND file_id=NEW.file_id) THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME = 'assignment_files' THEN
    IF EXISTS (SELECT 1 FROM assignment_files
      WHERE assignment_id=NEW.assignment_id AND file_id=NEW.file_id) THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME = 'submission_files' THEN
    IF EXISTS (SELECT 1 FROM submission_files WHERE submission_id=NEW.submission_id
      AND version_number=NEW.version_number AND file_id=NEW.file_id) THEN RETURN NEW; END IF;
  END IF;
  SELECT lifecycle_status INTO current_status FROM files WHERE id = NEW.file_id FOR UPDATE;
  IF current_status IS DISTINCT FROM 'PENDING' THEN
    RAISE EXCEPTION 'Only an owned PENDING file can be attached' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM material_files WHERE file_id = NEW.file_id) OR
     EXISTS (SELECT 1 FROM assignment_files WHERE file_id = NEW.file_id) OR
     EXISTS (SELECT 1 FROM submission_files WHERE file_id = NEW.file_id) THEN
    RAISE EXCEPTION 'File is already attached to a resource' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER material_file_single_parent BEFORE INSERT ON material_files
  FOR EACH ROW EXECUTE FUNCTION prevent_file_reuse();
CREATE TRIGGER assignment_file_single_parent BEFORE INSERT ON assignment_files
  FOR EACH ROW EXECUTE FUNCTION prevent_file_reuse();
CREATE TRIGGER submission_file_single_parent BEFORE INSERT ON submission_files
  FOR EACH ROW EXECUTE FUNCTION prevent_file_reuse();

CREATE FUNCTION mark_file_attached() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE files SET lifecycle_status = 'ATTACHED', attached_at = clock_timestamp()
  WHERE id = NEW.file_id AND lifecycle_status = 'PENDING';
  RETURN NEW;
END $$;
CREATE TRIGGER material_file_mark_attached AFTER INSERT ON material_files
  FOR EACH ROW EXECUTE FUNCTION mark_file_attached();
CREATE TRIGGER assignment_file_mark_attached AFTER INSERT ON assignment_files
  FOR EACH ROW EXECUTE FUNCTION mark_file_attached();
CREATE TRIGGER submission_file_mark_attached AFTER INSERT ON submission_files
  FOR EACH ROW EXECUTE FUNCTION mark_file_attached();

CREATE FUNCTION validate_submission_file_set() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE file_count integer; total_size bigint;
BEGIN
  SELECT count(*), COALESCE(sum(f.size_bytes), 0) INTO file_count, total_size
  FROM submission_files sf JOIN files f ON f.id = sf.file_id
  WHERE sf.submission_id = NEW.submission_id AND sf.version_number = NEW.version_number;
  IF file_count > 10 THEN
    RAISE EXCEPTION 'A submission version may contain at most 10 files' USING ERRCODE='23514';
  END IF;
  IF total_size > 104857600 THEN
    RAISE EXCEPTION 'A submission version may contain at most 100 MiB' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER submission_file_set_limits
  AFTER INSERT OR UPDATE ON submission_files DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_submission_file_set();

CREATE FUNCTION validate_assignment_file_set() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE file_count integer;
BEGIN
  SELECT count(*) INTO file_count FROM assignment_files WHERE assignment_id = NEW.assignment_id;
  IF file_count > 10 THEN
    RAISE EXCEPTION 'An assignment may contain at most 10 files' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER assignment_file_set_limits
  AFTER INSERT OR UPDATE ON assignment_files DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_assignment_file_set();
