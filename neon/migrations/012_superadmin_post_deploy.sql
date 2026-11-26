-- POST-DEPLOY ONLY: new auth and admin screens must be validated first.
BEGIN;
UPDATE dp.staff SET role='admin' WHERE lower(email)='opedrososamuel@gmail.com' AND active=true AND EXISTS (SELECT 1 FROM neon_auth."user" u WHERE u.id::text=dp.staff.user_id AND lower(u.email)='opedrososamuel@gmail.com');
DO $$ BEGIN IF (SELECT count(*) FROM dp.staff WHERE role='admin' AND active AND lower(email)='opedrososamuel@gmail.com')<>1 THEN RAISE EXCEPTION 'Superadmin não vinculado; preserve acesso anterior'; END IF; END $$;
COMMIT;
