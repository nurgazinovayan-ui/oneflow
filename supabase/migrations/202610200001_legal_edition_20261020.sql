-- New edition of the Terms of Service and the Privacy Policy (20 October 2026): the databases are in
-- Kazakhstan, consent to the cross-border transfer for the AI providers abroad, LemonSqueezy removed.
--
-- The edition equals LEGAL_VERSION in src/legalContent.ts. Run it right after the site with that
-- edition is published, not before: until then the old site sends the old edition and e-mail
-- sign-ups are refused. Every account is asked to accept the new edition once at its next login.
-- Safe to run again; never lowers the edition.
--
-- Rollback (together with the previous site): update public.app_settings set value = 20260901
-- where key = 'legal_version';

update public.app_settings set value = 20261020 where key = 'legal_version' and value < 20261020;
