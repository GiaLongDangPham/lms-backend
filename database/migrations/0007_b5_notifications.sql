-- B5 notification inbox cursor order. Keep 0001-0006 immutable.

CREATE INDEX notifications_recipient_created_id_idx
  ON notifications(recipient_id, created_at DESC, id DESC);
