-- 0015 — committee assignments for members of Congress (2026-10-08). Peter asked for better
-- politician profile pages; the first thing a reader asks about a member is which committees
-- they sit on. Source: the public-domain unitedstates/congress-legislators dataset
-- (committees-current + committee-membership-current), the same project the roster comes from.
-- Current assignments only: the roster job replaces the whole set on each run.
create table if not exists congress_committees (
    code         text primary key,                -- "thomas_id"; a subcommittee is parent code + its own id (HSAG15)
    parent_code  text references congress_committees(code) on delete cascade,
    chamber      text not null check (chamber in ('house','senate','joint')),
    name         text not null,
    url          text,
    jurisdiction text,
    updated_at   timestamptz not null default now()
);
create table if not exists congress_committee_members (
    committee_code text   not null references congress_committees(code) on delete cascade,
    person_id      bigint not null references people(id) on delete cascade,
    side           text,                          -- 'majority' | 'minority', as the source states it
    rank           int,
    title          text,                          -- Chair, Ranking Member, Vice Chair, … (null for a plain member)
    updated_at     timestamptz not null default now(),
    primary key (committee_code, person_id)
);
create index if not exists congress_committee_members_person_idx on congress_committee_members(person_id);
-- Read at build time through DATABASE_URL only; no public policy.
alter table congress_committees enable row level security;
alter table congress_committee_members enable row level security;
