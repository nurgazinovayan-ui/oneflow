-- The single-job ceiling (max_single_job_usd) follows the most expensive request the app can send:
-- Seedance 2.5 at 1080p for 30 seconds, 0.4 USD per second = 12 USD (the price tables of
-- generate-video and generate-video-pro). At 5 USD the app offered videos that were always refused:
-- Seedance 2.5 longer than 12 seconds at 1080p or about 21 seconds at 720p, Flux 3 Video longer
-- than 17 seconds at 1080p.
-- Only the old default is replaced; a value the owner set by hand stays. Credits, the monthly
-- allowance, rate limits, parallel jobs and the kill switch are unchanged.
update public.app_settings set value = 12 where key = 'max_single_job_usd' and value = 5;
