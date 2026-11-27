-- Q08: materials, like assignment resources, may contain at most ten files.
-- Keep all previously applied migrations unchanged.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM material_files GROUP BY material_id HAVING count(*) > 10) THEN
    RAISE EXCEPTION 'Review existing materials with more than ten attachments before applying B2';
  END IF;
END $$;

CREATE FUNCTION validate_material_file_set() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE file_count integer;
BEGIN
  SELECT count(*) INTO file_count FROM material_files WHERE material_id=NEW.material_id;
  IF file_count > 10 THEN
    RAISE EXCEPTION 'A material may contain at most 10 files' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER material_file_set_limits
  AFTER INSERT OR UPDATE ON material_files DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_material_file_set();
