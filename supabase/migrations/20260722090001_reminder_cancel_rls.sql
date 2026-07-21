create policy reminder_tasks_member_update on reminder_tasks for update to authenticated
  using (exists(select 1 from household_members hm where hm.household_id=reminder_tasks.household_id and hm.user_id=auth.uid()))
  with check (status='CANCELLED');
