-- 0016_decode_xml_entities_in_titles.sql
--
-- Data repair (idempotent), the companion of 0008. Officer titles from Form 4 were stored with
-- XML escapes intact ("EVP &amp; Chief Financial Officer" — seen live on 2026-10-09 on
-- /insiders/kress-colette/ and in the insider tables). 0008 repaired company and person names
-- only. The site also decodes titles when it builds (web/src/lib/flagship.ts), so a title that
-- arrives double-escaped from the source is shown correctly as well.
update person_roles
   set officer_title = replace(replace(replace(replace(replace(officer_title,
              '&amp;', '&'), '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&apos;', '''')
 where officer_title ~ '&(amp|lt|gt|quot|apos);';
