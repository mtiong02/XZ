-- Migration: 20260722220001_beta_feedback.sql
-- Create table for storing beta user feedbacks and suggestions

create table if not exists beta_feedbacks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete set null,
  category varchar(32) not null default 'SUGGESTION',
  content text not null,
  rating integer check (rating >= 1 and rating <= 5),
  contact text,
  status varchar(32) not null default 'OPEN',
  created_at timestamptz not null default now()
);

create index if not exists idx_beta_feedbacks_created_at on beta_feedbacks(created_at desc);
create index if not exists idx_beta_feedbacks_category on beta_feedbacks(category);
create index if not exists idx_beta_feedbacks_status on beta_feedbacks(status);

alter table beta_feedbacks enable row level security;

-- Authenticated users can insert feedback
create policy "Authenticated users can submit feedback"
  on beta_feedbacks for insert
  to authenticated
  with check (true);

-- Authenticated users can read their household's feedback
create policy "Users can view feedback from their household"
  on beta_feedbacks for select
  to authenticated
  using (
    household_id in (
      select household_id from household_members where user_id = auth.uid()
    )
  );
