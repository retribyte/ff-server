-- Fill Story.publishedDate (real-world publication date) for the archive's
-- older stories (the user's call, 2026-11-10). Dates come from the user's
-- recollection, Discord shares and the stories' Google Doc revision history
-- (last substantial edit). Still Waters and Horizon Meets Dawn already have
-- theirs; Vortox Machina stays NULL (still in progress).
-- reviewed: only fills rows where publishedDate IS NULL, so a date already set
-- in production is never overwritten; nothing else is touched. A slug that
-- doesn't exist is simply skipped.
UPDATE stories AS s SET "publishedDate" = v.d::timestamp
FROM (VALUES
    ('airlocked', '2018-09-20'),
    ('zombification', '2018-09-20'),
    ('the_interviews', '2018-09-22'),
    ('a_beginning', '2018-09-29'),
    ('a_conversation_between_gods', '2018-10-01'),
    ('chomskys_journal_audio_logs', '2018-10-16'),
    ('an_awakening', '2018-11-11'),
    ('one_whole_week', '2020-05-24'),
    ('wes_romaw_the_incident', '2020-05-30'),
    ('a_precarious_encounter', '2020-06-03'),
    ('deep_pockets', '2020-06-03'),
    ('aftermath_of_an_assassination', '2020-06-06'),
    ('a_quick_break', '2020-06-07'),
    ('do_emmetts_dream_of_llamanian_sheep', '2020-06-09'),
    ('a_bad_day_for_everyone', '2020-06-10'),
    ('everything_was_okay', '2020-11-10'),
    ('obama_story', '2021-05-17'),
    ('final_pummel', '2022-05-22'),
    ('three_days', '2022-06-18'),
    ('psychotherapy', '2022-07-02'),
    ('any_means_necessary', '2022-07-14'),
    ('give_no_quarter', '2022-08-09'),
    ('zachs_journey', '2022-09-22'),
    ('bellow_and_zach_train', '2022-09-24'),
    ('bellows_journal_and_audio_logs', '2022-09-27'),
    ('cold_comfort', '2022-10-08'),
    ('a_wonderful_family_reunion', '2022-10-17'),
    ('deafening_silence', '2022-11-03'),
    ('a_fateful_date', '2022-11-04'),
    ('knocked_and_rocked_asleep', '2022-11-15'),
    ('hesitation', '2022-11-29'),
    ('omg_zachs_gay_shocker', '2022-11-29'),
    ('cultural_spotlight', '2022-12-20'),
    ('the_moon_comes_over_the_tower', '2023-01-02'),
    ('ballistic_bonanza', '2023-01-04'),
    ('nehes_origin', '2023-03-13')
) AS v(slug, d)
WHERE s.slug = v.slug AND s."publishedDate" IS NULL;
