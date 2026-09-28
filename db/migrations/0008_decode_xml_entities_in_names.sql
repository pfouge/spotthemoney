-- 0008_decode_xml_entities_in_names.sql
--
-- Data repair (idempotent). Form 4 issuer and reporting-owner names were stored with their
-- XML escapes intact ("WELLS FARGO &amp; COMPANY/MN") by the first live sec_form4 runs; the
-- parser now decodes entities (sec_form4.ts decodeXmlEntities). Fix the rows already written.

update companies
   set name = replace(replace(replace(replace(replace(name,
              '&amp;', '&'), '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&apos;', '''')
 where name ~ '&(amp|lt|gt|quot|apos);';

update people
   set full_name = replace(replace(replace(replace(replace(full_name,
              '&amp;', '&'), '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&apos;', '''')
 where full_name ~ '&(amp|lt|gt|quot|apos);';
