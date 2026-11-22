-- 0035: roll-call votes of the House and the Senate (119th Congress on), stored only.
--
-- Source `congress_votes` (ingest/src/sources/congress_votes.ts) reads the Clerk's per-vote XML
-- (clerk.house.gov/evs/<year>/roll<NNN>.xml) and the Senate's per-vote XML
-- (senate.gov/legislative/LIS/roll_call_votes/...). One row in `congress_votes` is one vote; one
-- row in `congress_vote_positions` is one member's recorded position on it.
--
-- member_key is the Bioguide id for the House and the Senate's LIS member id for the Senate.
-- person_id is set when the member can be matched to people.bioguide_id (the Senate's LIS id is
-- translated through the congress-legislators file), and stays NULL otherwise.
--
-- Access follows 0022/0023/0032: row-level security on, no policy, no API grants; the read-only
-- build role may select. A later migration that exposes either table must grant by name.
-- Idempotent.

create table if not exists congress_votes (
    id            bigint generated always as identity primary key,
    chamber       text    not null check (chamber in ('house', 'senate')),
    congress      int     not null,
    session       int     not null,
    roll_number   int     not null,
    voted_at      date    not null,
    vote_time     text,
    question      text,
    vote_type     text,
    result        text,
    bill          text,
    description   text,
    yeas          int,
    nays          int,
    present       int,
    not_voting    int,
    source_url    text,
    created_at    timestamptz not null default now(),
    unique (chamber, congress, session, roll_number)
);
create index if not exists congress_votes_voted_at_idx on congress_votes (voted_at desc);
create index if not exists congress_votes_bill_idx on congress_votes (bill);

create table if not exists congress_vote_positions (
    vote_id    bigint not null references congress_votes(id) on delete cascade,
    member_key text   not null,
    person_id  bigint references people(id) on delete set null,
    name       text,
    party      text,
    state      text,
    position   text   not null check (position in ('yea', 'nay', 'present', 'not_voting')),
    primary key (vote_id, member_key)
);
create index if not exists congress_vote_positions_person_idx on congress_vote_positions (person_id, vote_id);

alter table congress_votes enable row level security;
alter table congress_vote_positions enable row level security;
revoke all on congress_votes from anon, authenticated;
revoke all on congress_vote_positions from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'site_build') then
    grant select on congress_votes to site_build;
    grant select on congress_vote_positions to site_build;
  end if;
end $$;
