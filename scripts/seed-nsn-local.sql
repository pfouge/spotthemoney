-- A small local stand-in for nsnexplorer.com's database: the three tables the build reads
-- (pub.contract_actions, pub.suppliers, pub.nsns), with the columns it uses. For local builds and
-- verify-dla only. Create a database `nsn`, run this file, and build with
--   NSN_DATABASE_URL=postgres://postgres@127.0.0.1:5433/nsn
-- What it holds, against the seed companies (scripts/seed-local.sql):
--   Lockheed Martin: CAGE 03538 (name rule, through a "DIV" name), 78286 Sikorsky (subsidiary rule),
--   and a base contract (PIID type D, no delivery order) worth $60 billion that must not count.
--   A supplier with no name anywhere (6HW96), and one that matches nothing (9ZZZ9).
--   A purchase order dated tomorrow and one 400 days old, both outside the window.
drop schema if exists pub cascade;
create schema pub;
create table pub.suppliers (cage text primary key, name text, uei text, city text, state text, country text);
create table pub.nsns (nsn text primary key, niin text, fsc text, item_name text);
create table pub.contract_actions (
  id bigserial primary key, source text not null default 'dibbs', action_date date, obligation numeric,
  recipient_name text, recipient_uei text, source_url text, raw jsonb
);

insert into pub.suppliers (cage, name) values
  ('03538', 'LOCKHEED MARTIN CORPORATION DIV MISSILES AND FIRE CONTROL'),
  ('78286', 'SIKORSKY AIRCRAFT CORPORATION'),
  ('9ZZZ9', 'WIDGETS UNLIMITED LLC');

-- helper: one DIBBS record
create function pg_temp.r(d int, cage text, nsn text, item text, award text, dord text, amt numeric, rn text) returns void language sql as $$
  insert into pub.contract_actions (action_date, obligation, recipient_name, source_url, raw)
  values (current_date - d, amt, rn, 'https://www.dibbs.bsm.dla.mil/Awards/AwdRec.aspx?Category=post&TypeSrch=cq&Value=' || coalesce(dord, award),
          jsonb_build_object('cage', cage, 'nsn', nsn, 'nomenclature', item, 'awardNumber', award, 'deliveryOrder', dord, 'total', amt::text));
$$;

select pg_temp.r(3,   '03538', '1410015123456', 'GUIDED MISSILE COMPO', 'SPE4A126D0042', 'SPE4A126F0101', 1250000.00, 'LOCKHEED MARTIN CORPORATION');
select pg_temp.r(10,  '03538', '1410015123456', 'GUIDED MISSILE COMPO', 'SPE4A126D0042', 'SPE4A126F0102', 980000.00,  'LOCKHEED MARTIN CORPORATION');
select pg_temp.r(41,  '03538', '5998016654321', 'CIRCUIT CARD ASSEMB',  'SPE4A726P3311', null,            42150.75,   'LOCKHEED MARTIN CORPORATION');
select pg_temp.r(75,  '03538', '6105012223344', 'MOTOR,DIRECT CURRENT', 'SPE4A726P4410', null,            8800.00,    null);
select pg_temp.r(150, '03538', '5340013494824', 'BRACKET,MOUNTING',     'SPE7M126V0099', null,            1234.56,    'LOCKHEED MARTIN CORPORATION');
select pg_temp.r(5,   '78286', '1615014445555', 'BLADE,ROTARY WING',    'SPRPA126D0007', 'SPRPA126F0050', 2400000.00, 'SIKORSKY AIRCRAFT CORP');
select pg_temp.r(60,  '78286', '1615014445555', 'BLADE,ROTARY WING',    'SPRPA126D0007', 'SPRPA126F0051', 2400000.00, 'SIKORSKY AIRCRAFT CORP');
select pg_temp.r(200, '78286', '1680019998877', 'SEAL,NONMETALLIC',     'SPRPA126P0412', null,            15.00,      'SIKORSKY AIRCRAFT CORP');
-- a base contract posted with its ceiling: never counted
select pg_temp.r(20,  '03538', '4240015556666', 'CARTRIDGE,RESPIRATO', 'SPE2DH26D0001', null,            60000000000.00, 'LOCKHEED MARTIN CORPORATION');
-- outside the window: tomorrow, and 400 days ago
select pg_temp.r(-1,  '03538', '5340013494824', 'BRACKET,MOUNTING',     'SPE7M126V0100', null,            500.00,     'LOCKHEED MARTIN CORPORATION');
select pg_temp.r(400, '03538', '5340013494824', 'BRACKET,MOUNTING',     'SPE7M125V0001', null,            700.00,     'LOCKHEED MARTIN CORPORATION');
-- a zero-value modification
select pg_temp.r(12,  '03538', '5340013494824', 'BRACKET,MOUNTING',     'SPE7M126V0101', null,            0,          'LOCKHEED MARTIN CORPORATION');
-- no name anywhere, and a supplier that matches no company
select pg_temp.r(4,   '6HW96', '2520017778888', 'TRANSMISSION,MECHAN', 'SPRDL126P0001', null,            793000.00,  null);
select pg_temp.r(7,   '9ZZZ9', '5305000001111', 'SCREW,CAP,HEXAGON H', 'SPE7L126P0001', null,            321.00,     'WIDGETS UNLIMITED LLC');
-- a record without a CAGE (USAspending-style): never read
insert into pub.contract_actions (source, action_date, obligation, recipient_name, raw) values ('usaspending', current_date - 2, 5000000, 'LOCKHEED MARTIN CORP', '{"piid":"X"}');
