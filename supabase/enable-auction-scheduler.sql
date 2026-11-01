-- OPTIONAL configuration. Run only in the dedicated test database first.
-- Requires pg_cron with second-interval support; enable it in Supabase Integrations > Cron.
select cron.schedule('cricmate-auction-tick', '1 second', 'select public.tick_due_auctions()');
-- Verify active configuration and successful executions; then test with ALL browsers closed.
select jobid, jobname, schedule, active from cron.job where jobname='cricmate-auction-tick';
select status, return_message, start_time, end_time from cron.job_run_details
 where jobid=(select jobid from cron.job where jobname='cricmate-auction-tick') order by start_time desc limit 10;
-- Rollback: select cron.unschedule('cricmate-auction-tick');
