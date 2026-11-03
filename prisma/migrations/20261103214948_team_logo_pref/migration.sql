-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "logoPref" TEXT;


-- Start the teams whose standard logo is navy/black (invisible on the dark
-- site) on the dark version, plus Ohio State (owner's call). Everything else
-- stays on the standard logo until picked at /admin/logos.
UPDATE "Team" SET "logoPref" = 'dark'
WHERE "canonicalName" IN ('Akron', 'UTSA', 'Nevada', 'TCU', 'Utah State', 'New Mexico State', 'Ohio State');
