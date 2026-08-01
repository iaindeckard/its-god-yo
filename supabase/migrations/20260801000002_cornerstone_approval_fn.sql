-- Cornerstone Partner Program — transaction-safe approval + numbering.
-- Spec requires atomic, concurrency-safe, never-reused partner numbers. Doing the
-- assignment in one DB function (rather than app-side read-then-write) guarantees
-- it: the application row is locked FOR UPDATE, the number comes from the
-- sequence, and cornerstone_partners.church_id is UNIQUE — so two concurrent
-- approvals of the same church can never both mint a number, and the function is
-- idempotent (re-approving returns the existing number instead of a second one).

CREATE OR REPLACE FUNCTION public.approve_cornerstone_application(
  p_application_id uuid,
  p_reviewer       uuid DEFAULT NULL,
  p_reason         text DEFAULT NULL
)
RETURNS TABLE (partner_id uuid, partner_number integer, already_partner boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app     public.cornerstone_applications%ROWTYPE;
  v_existing public.cornerstone_partners%ROWTYPE;
  v_num     integer;
  v_pid     uuid;
  v_listing text;
BEGIN
  -- Lock the application so concurrent approvals serialize.
  SELECT * INTO v_app FROM public.cornerstone_applications
    WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cornerstone application % not found', p_application_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Idempotent: if this church already has a partner record, return it.
  SELECT * INTO v_existing FROM public.cornerstone_partners
    WHERE church_id = v_app.church_id;
  IF FOUND THEN
    UPDATE public.cornerstone_applications
       SET status = 'approved', reviewed_at = COALESCE(reviewed_at, now()),
           reviewed_by = COALESCE(reviewed_by, p_reviewer), updated_at = now()
     WHERE id = p_application_id;
    partner_id := v_existing.id; partner_number := v_existing.partner_number; already_partner := true;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Default public listing follows the church's recognition consent.
  SELECT CASE WHEN public_recognition_opt_in THEN 'listed' ELSE 'private' END
    INTO v_listing FROM public.churches WHERE id = v_app.church_id;

  v_num := nextval('public.cornerstone_partner_seq');

  INSERT INTO public.cornerstone_partners
    (church_id, application_id, partner_number, cornerstone_status,
     recognition_date, activation_date, public_listing_status,
     original_qualifying_plan)
  VALUES
    (v_app.church_id, p_application_id, v_num, 'active',
     current_date, current_date, COALESCE(v_listing,'private'),
     v_app.preferred_plan)
  RETURNING id INTO v_pid;

  UPDATE public.cornerstone_applications
     SET status = 'approved', reviewed_at = now(), reviewed_by = p_reviewer, updated_at = now()
   WHERE id = p_application_id;

  INSERT INTO public.cornerstone_audit_log
    (partner_id, application_id, action, new_value, performed_by, reason)
  VALUES
    (v_pid, p_application_id, 'partner_approved',
     jsonb_build_object('partner_number', v_num), p_reviewer, p_reason);

  partner_id := v_pid; partner_number := v_num; already_partner := false;
  RETURN NEXT;
END;
$$;

-- Callable by the service role (the admin client) only; not granted to anon.
REVOKE ALL ON FUNCTION public.approve_cornerstone_application(uuid, uuid, text) FROM PUBLIC;
