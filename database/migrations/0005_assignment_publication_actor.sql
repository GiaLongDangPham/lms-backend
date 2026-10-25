-- Record the teacher responsible for assignment-wide result publication.
-- Keep 0001-0004 immutable; the migration runner supplies the transaction.

ALTER TABLE assignments ADD COLUMN results_published_by uuid
  REFERENCES users(id) ON DELETE RESTRICT;

UPDATE assignments a SET results_published_by = COALESCE(
  (
    SELECT gh.changed_by
    FROM grade_history gh
    JOIN grades g ON g.id = gh.grade_id
    WHERE g.assignment_id = a.id AND gh.status = 'PUBLISHED'
    ORDER BY gh.changed_at, gh.grade_id, gh.version
    LIMIT 1
  ),
  (
    SELECT g.published_by
    FROM grades g
    WHERE g.assignment_id = a.id AND g.status = 'PUBLISHED' AND g.published_by IS NOT NULL
    ORDER BY g.published_at, g.id
    LIMIT 1
  ),
  a.created_by
) WHERE a.results_published_at IS NOT NULL;

ALTER TABLE assignments ADD CONSTRAINT assignments_results_publication_pair CHECK (
  (results_published_at IS NULL) = (results_published_by IS NULL));

CREATE OR REPLACE FUNCTION check_assignment_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.class_id IS DISTINCT FROM OLD.class_id AND (
    EXISTS(SELECT 1 FROM submissions WHERE assignment_id=OLD.id) OR EXISTS(SELECT 1 FROM grades WHERE assignment_id=OLD.id)) THEN
    RAISE EXCEPTION 'Assignment with results cannot change class' USING ERRCODE='23514';
  END IF;
  IF NEW.max_score IS DISTINCT FROM OLD.max_score AND EXISTS(SELECT 1 FROM grades WHERE assignment_id=OLD.id AND score > NEW.max_score) THEN
    RAISE EXCEPTION 'Maximum score cannot be lower than an existing grade' USING ERRCODE='23514';
  END IF;
  IF OLD.results_published_at IS NOT NULL AND
    (NEW.results_published_at,NEW.results_published_by) IS DISTINCT FROM
    (OLD.results_published_at,OLD.results_published_by) THEN
    RAISE EXCEPTION 'Publication time and actor cannot change' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
