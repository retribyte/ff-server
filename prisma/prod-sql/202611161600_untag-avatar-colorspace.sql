-- Strips the color-space chunks (sRGB, gAMA, cHRM, iCCP, cICP, mDCV, cLLI) from
-- every stored avatar PNG. Aseprite tags its exports sRGB; a color-managed
-- browser then converts the tagged sprite into the monitor's profile, so on a
-- wide-gamut display it no longer matches the untagged outline PixelAvatar draws
-- around it, or the colors the artist picked. New uploads are stripped by
-- stripColorSpace() in src/utils/avatar-image.ts; this does the same to rows
-- already stored.
--
-- Avatar URLs are content hashes served as immutable, so each cleaned image is
-- inserted under its new sha256 and the references are repointed; the old rows
-- stay (another record, or a cached page, may still name them).
--
-- reviewed: the UPDATEs only repoint characters.image, personas.image and
-- items.image from a /api/avatars/<old sha> path to the cleaned copy of that same
-- image, inserted just before. Nothing is deleted; re-running changes nothing.
DO $$
DECLARE
    r record;
    src bytea;
    dst bytea;
    o int;
    len int;
    typ text;
    changed boolean;
    newsha text;
BEGIN
    FOR r IN SELECT sha256, data FROM avatar_images LOOP
        src := r.data;
        CONTINUE WHEN substring(src from 1 for 8) <> '\x89504e470d0a1a0a'::bytea;
        dst := substring(src from 1 for 8);
        o := 9;
        changed := false;
        WHILE o + 11 <= length(src) LOOP
            len := (get_byte(src, o - 1) << 24) | (get_byte(src, o) << 16) | (get_byte(src, o + 1) << 8) | get_byte(src, o + 2);
            IF o + 11 + len > length(src) THEN
                dst := NULL; -- malformed: leave this image alone
                EXIT;
            END IF;
            typ := convert_from(substring(src from o + 4 for 4), 'LATIN1');
            IF typ IN ('sRGB', 'gAMA', 'cHRM', 'iCCP', 'cICP', 'mDCV', 'cLLI') THEN
                changed := true;
            ELSE
                dst := dst || substring(src from o for 12 + len);
            END IF;
            o := o + 12 + len;
        END LOOP;
        CONTINUE WHEN dst IS NULL OR NOT changed;

        newsha := encode(sha256(dst), 'hex');
        INSERT INTO avatar_images (sha256, data) VALUES (newsha, dst) ON CONFLICT (sha256) DO NOTHING;
        UPDATE characters SET image = '/api/avatars/' || newsha || '.png' WHERE image = '/api/avatars/' || r.sha256 || '.png';
        UPDATE personas SET image = '/api/avatars/' || newsha || '.png' WHERE image = '/api/avatars/' || r.sha256 || '.png';
        UPDATE items SET image = '/api/avatars/' || newsha || '.png' WHERE image = '/api/avatars/' || r.sha256 || '.png';
    END LOOP;
END
$$;
