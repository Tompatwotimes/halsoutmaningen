-- ============================================================================
-- Hälsoutmaningen — GM1 / templates  Game Master roast bank (96 V1 templates)
--
-- Depends on 0015 (game_master_templates + _game_master_validate_template trigger)
-- and 0016 (the engine that renders + freezes these into game_master_events).
-- Forward-only, non-destructive, ADDITIVE — this migration ONLY seeds data. No
-- schema change, no policy, no function.
--
-- These are the hand-written GM1 roasts (NO AI, spec §18). Each row is frozen
-- into a game_master_events row at emission time; source-data changes never
-- rewrite an emitted roast.
--
-- Distribution (spec §18, total 96):
--   missed_day 14 · streak_long 12 · streak_broken 14 · debt_leader 10 ·
--   kassan 10 · comeback 10 · ranking_position 8 · historic_callback 10 ·
--   general_system 8
--
-- Placeholder discipline: a template may use ONLY the placeholders its family's
-- engine payload actually provides (0016 _game_master_candidates). An absent key
-- renders as the empty string, so an out-of-family placeholder would look broken.
-- The 0015 trigger only enforces the 12-word global allow-list; the per-family
-- discipline is enforced by pgTAP (0015 seed assertions).
--   missed_day        {name} {missed_days} {completed_days} {eligible_days}
--                     {days_until_final} {final_date} {participant_count}
--   streak_long       {name} {streak} {days_until_final} {final_date} {participant_count}
--   streak_broken     {name} {previous_streak} {streak} {days_until_final}
--                     {final_date} {participant_count}
--   debt_leader       {name} {debt_sek} {kassan_sek} {days_until_final}
--                     {final_date} {participant_count}
--   kassan            {kassan_sek} {days_until_final} {final_date}
--                     {participant_count}   (NO subject, NEVER {name})
--   comeback          {name} {streak} {previous_streak} {days_until_final}
--                     {final_date} {participant_count}
--   ranking_position  {name} {rank} {completed_days} {participant_count}
--                     {days_until_final} {final_date}   ({rank}=1 leader … =count last)
--   historic_callback {name} {previous_streak} {days_until_final} {final_date}
--                     {participant_count}
--   general_system    {participant_count} {days_until_final} {final_date}
--                     {kassan_sek}   (NO subject, NEVER {name})
--
-- Severity (spec §3): 1 dry observation · 2 light jab · 3 roast · 4 acidic ·
-- 5 surgical execution. Exactly 16 rows are severity 5; every severity-5 row is
-- either once_per_subject OR cooldown_hours >= 336, and private severity-5
-- (9 rows) outnumbers public severity-5 (7 rows) so a "vad fan skrev appen
-- precis?" moment stays rare and mostly personal.
--
-- archive: private templates are archive=false (private events never archive
-- anyway — 0016 forces it); most public templates archive=true, the low-value
-- severity-1 ones and all general_system rows are archive=false.
--
-- final_weight > 1 nudges a template commoner near the finale — only the rows
-- that actually lean on {days_until_final} / {final_date} carry it.
--
-- No template mentions tokens, competitions, titles, rivalries or prizes, and
-- none promises the reader a reward — that is GM2+ territory (spec §11–§15, §19).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- missed_day (14) — private. A freshly missed eligible day. Never archived.
-- Carries the bulk of the severity-5 bank because private surgical roasts are
-- the ones the spec wants to sting without becoming group spectacle.
-- ----------------------------------------------------------------------------
insert into public.game_master_templates
  (template_key, family, visibility, severity, title_template, body_template,
   weight, cooldown_hours, once_per_subject, archive, final_weight)
values
  ('missed_day_001', 'missed_day', 'private', 3,
   'SYSTEMET HAR NOTERAT EN AVVIKELSE',
   $b$Kravet var 30 minuter. Dygnet innehöll 1 440.$b$,
   1.0, 168, false, false, 1.0),

  ('missed_day_002', 'missed_day', 'private', 3,
   'INCIDENTRAPPORT',
   $b${name} misslyckades med att hitta 30 minuter under ett helt dygn. Försvarsmaktens fortsatta existens bedöms tills vidare inte vara hotad.$b$,
   1.0, 168, false, false, 1.0),

  ('missed_day_003', 'missed_day', 'private', 1,
   'NOTERING',
   $b$Ingen registrering idag. Systemet drar inga slutsatser än.$b$,
   1.0, 120, false, false, 1.0),

  ('missed_day_004', 'missed_day', 'private', 2,
   'PÅMINNELSE',
   $b${name} har nu {missed_days} missade dagar. Det är fler än noll.$b$,
   1.0, 120, false, false, 1.0),

  ('missed_day_005', 'missed_day', 'private', 2,
   'AVVIKELSE',
   $b${completed_days} av {eligible_days} dagar avklarade. Resten kallas i protokollet för luckor.$b$,
   1.0, 120, false, false, 1.0),

  ('missed_day_006', 'missed_day', 'private', 4,
   'STATUS',
   $b${name} valde soffan. Soffan valde tillbaka. Skulden växer under tiden.$b$,
   1.0, 240, false, false, 1.0),

  ('missed_day_007', 'missed_day', 'private', 5,
   'SAMMANSTÄLLNING',
   $b${missed_days} dagar utan insats. Kroppen har noterat det även om {name} inte har det.$b$,
   1.0, 336, true, false, 1.0),

  ('missed_day_008', 'missed_day', 'private', 5,
   'SLUTGILTIG NOTERING',
   $b${name}: {missed_days} missade dagar, {completed_days} avklarade. Det finns {days_until_final} dagar kvar till {final_date} och matematiken har redan bestämt sig.$b$,
   1.0, 336, true, false, 1.8),

  ('missed_day_009', 'missed_day', 'private', 5,
   'SYSTEMET HAR SLUTAT VÄNTA',
   $b$Trettio minuter av tjugofyra timmar. {name} har nu {missed_days} gånger bedömt att det var för mycket begärt.$b$,
   1.0, 336, true, false, 1.0),

  ('missed_day_010', 'missed_day', 'private', 5,
   'PROTOKOLL',
   $b$Registret visar {missed_days} dagar där {name} inte gjorde någonting alls. Registret är inte känsloladdat. Det bara minns.$b$,
   1.0, 336, true, false, 1.0),

  ('missed_day_011', 'missed_day', 'private', 5,
   'AVVIKELSERAPPORT',
   $b${name} deltar i en utmaning om 30 minuter per dag och har hittills producerat {missed_days} dagar av tystnad.$b$,
   1.0, 336, true, false, 1.0),

  ('missed_day_012', 'missed_day', 'private', 5,
   'KALL SUMMERING',
   $b${completed_days} avklarade dagar. {missed_days} missade. {name} vet redan vilken av siffrorna som växer snabbast.$b$,
   1.0, 336, true, false, 1.0),

  ('missed_day_013', 'missed_day', 'private', 5,
   'SYSTEMET HAR NOTERAT ETT MÖNSTER',
   $b$Det är inte otur längre. {name} har {missed_days} missade dagar och en förklaring som blir kortare varje gång.$b$,
   1.0, 336, true, false, 1.0),

  ('missed_day_014', 'missed_day', 'private', 5,
   'INCIDENT',
   $b${name} lade mer tid på att inte träna än de 30 minuter det hade tagit. {missed_days} dagar, samma beslut.$b$,
   1.0, 336, true, false, 1.0);

-- ----------------------------------------------------------------------------
-- streak_long (12) — public. An active streak crossing 7/14/21/30/45/60.
-- No severity-5: a long streak is not a surgical-execution event.
-- ----------------------------------------------------------------------------
insert into public.game_master_templates
  (template_key, family, visibility, severity, title_template, body_template,
   weight, cooldown_hours, once_per_subject, archive, final_weight)
values
  ('streak_long_001', 'streak_long', 'public', 3,
   'STATUS',
   $b${name} har {streak} dagar i rad. Självförtroendet bedöms nu ligga farligt långt före den dokumenterade atletiska förmågan.$b$,
   1.0, 168, false, true, 1.0),

  ('streak_long_002', 'streak_long', 'public', 1,
   'NOTERING',
   $b${name}: {streak} dagar i rad. Systemet noterar utan att applådera.$b$,
   1.0, 120, false, false, 1.0),

  ('streak_long_003', 'streak_long', 'public', 2,
   'OBSERVATION',
   $b${name} har tränat {streak} dagar i följd och börjar prata om det som om ingen annan gör det.$b$,
   1.0, 120, false, true, 1.0),

  ('streak_long_004', 'streak_long', 'public', 2,
   'STATUS',
   $b${streak} dagar i rad för {name}. Imponerande tills man minns att kravet bara är 30 minuter.$b$,
   1.0, 120, false, true, 1.0),

  ('streak_long_005', 'streak_long', 'public', 2,
   'RAPPORT',
   $b${name} håller {streak} dagar. Resten av {participant_count} deltagare har också fått höra om det.$b$,
   1.0, 120, false, true, 1.0),

  ('streak_long_006', 'streak_long', 'public', 3,
   'MÖNSTER',
   $b${name} har {streak} dagar i rad och en ny vana att nämna det i varje samtal.$b$,
   1.0, 168, false, true, 1.0),

  ('streak_long_007', 'streak_long', 'public', 3,
   'SYSTEMET FÖLJER',
   $b${streak} raka dagar. {name} har gått från deltagare till föreläsare.$b$,
   1.0, 168, false, true, 1.0),

  ('streak_long_008', 'streak_long', 'public', 3,
   'STATUS',
   $b${name}: {streak} dagar. Formkurvan pekar uppåt, ödmjukheten åt andra hållet.$b$,
   1.0, 168, false, true, 1.0),

  ('streak_long_009', 'streak_long', 'public', 3,
   'NOTERING',
   $b${name} har {streak} dagar utan avbrott och {days_until_final} dagar kvar att förlora dem på innan {final_date}.$b$,
   1.0, 168, false, true, 1.6),

  ('streak_long_010', 'streak_long', 'public', 4,
   'ANALYS',
   $b${name} har {streak} dagar i rad. Statistiskt sett är det nu bara en tidsfråga innan berättelsen om det blir längre än sträckan själv.$b$,
   1.0, 240, false, true, 1.0),

  ('streak_long_011', 'streak_long', 'public', 4,
   'SYSTEMET HAR SETT DET HÄR FÖRR',
   $b${name} bygger {streak} dagar och ett självförtroende som historiskt inte har åldrats väl.$b$,
   1.0, 240, false, true, 1.0),

  ('streak_long_012', 'streak_long', 'public', 4,
   'LÄGESBILD',
   $b${streak} dagar för {name}. Ingen har frågat, alla vet.$b$,
   1.0, 240, false, true, 1.0);

-- ----------------------------------------------------------------------------
-- streak_broken (14) — public. A recently ended run >= 5 days, magnitude on
-- {previous_streak}. Three severity-5 rows, all once_per_subject.
-- ----------------------------------------------------------------------------
insert into public.game_master_templates
  (template_key, family, visibility, severity, title_template, body_template,
   weight, cooldown_hours, once_per_subject, archive, final_weight)
values
  ('streak_broken_001', 'streak_broken', 'public', 1,
   'NOTERING',
   $b${name} bröt en svit på {previous_streak} dagar. Systemet konstaterar, inget mer.$b$,
   1.0, 120, false, false, 1.0),

  ('streak_broken_002', 'streak_broken', 'public', 2,
   'AVBROTT',
   $b${previous_streak} dagar i rad, sedan inte. {name} är tillbaka på ruta ett med {streak} dagar.$b$,
   1.0, 120, false, true, 1.0),

  ('streak_broken_003', 'streak_broken', 'public', 2,
   'STATUS',
   $b$Sviten på {previous_streak} dagar är slut. {name} pratar redan om den i dåtid som om den var längre.$b$,
   1.0, 120, false, true, 1.0),

  ('streak_broken_004', 'streak_broken', 'public', 2,
   'RAPPORT',
   $b${name} tappade {previous_streak} dagar. Resten av {participant_count} deltagare fortsatte som vanligt.$b$,
   1.0, 120, false, true, 1.0),

  ('streak_broken_005', 'streak_broken', 'public', 3,
   'SYSTEMET HAR NOTERAT ETT FALL',
   $b$Från {previous_streak} dagar till {streak}. {name} kallar det vila. Kalendern kallar det något annat.$b$,
   1.0, 168, false, true, 1.0),

  ('streak_broken_006', 'streak_broken', 'public', 3,
   'ANALYS',
   $b${name} höll {previous_streak} dagar och slarvade bort dem på en enda kväll. Effektivt, på sitt sätt.$b$,
   1.0, 168, false, true, 1.0),

  ('streak_broken_007', 'streak_broken', 'public', 3,
   'MÖNSTER',
   $b${name} bygger långa sviter för att sedan riva dem själv. {previous_streak} dagar den här gången.$b$,
   1.0, 168, false, true, 1.0),

  ('streak_broken_008', 'streak_broken', 'public', 3,
   'LÄGESBILD',
   $b$Sviten: {previous_streak} dagar. Återstoden: {streak}. Skillnaden: ett beslut {name} helst inte pratar om.$b$,
   1.0, 168, false, true, 1.0),

  ('streak_broken_009', 'streak_broken', 'public', 4,
   'SYSTEMET MINNS',
   $b${name} var {previous_streak} dagar in och hade mage att kalla sig disciplinerad. Nu {streak} dagar och tystare.$b$,
   1.0, 240, false, true, 1.0),

  ('streak_broken_010', 'streak_broken', 'public', 4,
   'EFTERANALYS',
   $b${previous_streak} dagars arbete raderat på mindre tid än det tar att läsa den här meningen. {name}, det var allt.$b$,
   1.0, 240, false, true, 1.0),

  ('streak_broken_011', 'streak_broken', 'public', 4,
   'NOTERING',
   $b${name} förlorade en svit på {previous_streak} dagar med {days_until_final} dagar kvar till {final_date}. Tajmingen var, som alltid, oklanderlig.$b$,
   1.0, 240, false, true, 1.5),

  ('streak_broken_012', 'streak_broken', 'public', 5,
   'SLUTGILTIG EFTERANALYS',
   $b${name} byggde {previous_streak} dagar, tappade allt, och står nu på {streak}. Systemet har sett byggnadsställningar rasa mer graciöst.$b$,
   1.0, 336, true, true, 1.0),

  ('streak_broken_013', 'streak_broken', 'public', 5,
   'PROTOKOLL',
   $b${previous_streak} dagar av bevisad förmåga, frivilligt avvecklad. {name} hade ett val och valde detta.$b$,
   1.0, 336, true, true, 1.0),

  ('streak_broken_014', 'streak_broken', 'public', 5,
   'KALL SUMMERING',
   $b$Registret noterar: {name}, svit {previous_streak} dagar, nedlagd av egen hand. Ingen extern motståndare inblandad.$b$,
   1.0, 336, true, true, 1.0);

-- ----------------------------------------------------------------------------
-- debt_leader (10) — public. The single highest positive liability right now.
-- Two severity-5 rows, both once_per_subject.
-- ----------------------------------------------------------------------------
insert into public.game_master_templates
  (template_key, family, visibility, severity, title_template, body_template,
   weight, cooldown_hours, once_per_subject, archive, final_weight)
values
  ('debt_leader_001', 'debt_leader', 'public', 2,
   'EKONOMI',
   $b${name} leder skuldligan med {debt_sek} kr. Någon måste, och den här gången är det tydligt vem.$b$,
   1.0, 120, false, true, 1.0),

  ('debt_leader_002', 'debt_leader', 'public', 2,
   'NOTERING',
   $b$Störst skuld just nu: {name}, {debt_sek} kr. Av gruppens totala {kassan_sek} kr är en anmärkningsvärd andel personlig.$b$,
   1.0, 120, false, true, 1.0),

  ('debt_leader_003', 'debt_leader', 'public', 2,
   'STATUS',
   $b${name} ligger på {debt_sek} kr i skuld. Ett engagemang, om än inte det avsedda.$b$,
   1.0, 120, false, true, 1.0),

  ('debt_leader_004', 'debt_leader', 'public', 3,
   'SYSTEMET RÄKNAR',
   $b${name} har missat sig till {debt_sek} kr. Kassan tackar för bidraget.$b$,
   1.0, 168, false, true, 1.0),

  ('debt_leader_005', 'debt_leader', 'public', 3,
   'EKONOMISK LÄGESBILD',
   $b${debt_sek} kr. Det är vad {name}s ambition har kostat hittills, mätt i den enda enhet som inte ljuger.$b$,
   1.0, 168, false, true, 1.0),

  ('debt_leader_006', 'debt_leader', 'public', 3,
   'RAPPORT',
   $b${name} toppar skulden med {debt_sek} kr och {days_until_final} dagar kvar att bygga vidare på den till {final_date}.$b$,
   1.0, 168, false, true, 1.5),

  ('debt_leader_007', 'debt_leader', 'public', 4,
   'ANALYS',
   $b${name}s skuld på {debt_sek} kr är inte längre en olyckshändelse. Det är en prenumeration.$b$,
   1.0, 240, false, true, 1.0),

  ('debt_leader_008', 'debt_leader', 'public', 4,
   'SYSTEMET HAR NOTERAT',
   $b${name} betalar hellre {debt_sek} kr än lägger 30 minuter per dag. Marknaden har talat.$b$,
   1.0, 240, false, true, 1.0),

  ('debt_leader_009', 'debt_leader', 'public', 5,
   'SLUTGILTIG EKONOMISK NOTERING',
   $b${name}: {debt_sek} kr i skuld, av gruppens {kassan_sek} kr. Det är inte otur. Det är en affärsmodell där {name} är förlustposten.$b$,
   1.0, 336, true, true, 1.0),

  ('debt_leader_010', 'debt_leader', 'public', 5,
   'PROTOKOLL',
   $b${name} har konsekvent valt bort 30 minuter till en sammanlagd kostnad av {debt_sek} kr. Systemet har inga fler frågor.$b$,
   1.0, 336, true, true, 1.0);

-- ----------------------------------------------------------------------------
-- kassan (10) — public, NO subject. Total group liability, bucketed. NEVER
-- uses {name}. One severity-5 row — no subject, so cooldown_hours = 504.
-- ----------------------------------------------------------------------------
insert into public.game_master_templates
  (template_key, family, visibility, severity, title_template, body_template,
   weight, cooldown_hours, once_per_subject, archive, final_weight)
values
  ('kassan_001', 'kassan', 'public', 3,
   'KASSAN',
   $b$Gruppen har nu gemensamt misslyckats ihop till {kassan_sek} kr. Det börjar likna en finansieringsmodell.$b$,
   1.0, 168, false, true, 1.0),

  ('kassan_002', 'kassan', 'public', 1,
   'KASSAN',
   $b$Aktuell summa: {kassan_sek} kr. Systemet rapporterar utan att döma.$b$,
   1.0, 120, false, false, 1.0),

  ('kassan_003', 'kassan', 'public', 1,
   'NOTERING',
   $b${kassan_sek} kr i kassan. {participant_count} deltagare har bidragit i olika grad.$b$,
   1.0, 120, false, false, 1.0),

  ('kassan_004', 'kassan', 'public', 2,
   'KASSAN',
   $b${kassan_sek} kr. Ingen planerade det här, alla byggde det tillsammans.$b$,
   1.0, 120, false, true, 1.0),

  ('kassan_005', 'kassan', 'public', 2,
   'EKONOMISK LÄGESBILD',
   $b$Kassan står på {kassan_sek} kr med {days_until_final} dagar kvar till {final_date}. Prognosen är stabilt uppåt.$b$,
   1.0, 120, false, true, 1.6),

  ('kassan_006', 'kassan', 'public', 2,
   'KASSAN',
   $b${kassan_sek} kr insamlat genom ren frånvaro. Effektivare än de flesta insamlingar.$b$,
   1.0, 120, false, true, 1.0),

  ('kassan_007', 'kassan', 'public', 3,
   'SYSTEMET SUMMERAR',
   $b${participant_count} vuxna människor har tillsammans avstått träning till ett värde av {kassan_sek} kr.$b$,
   1.0, 168, false, true, 1.0),

  ('kassan_008', 'kassan', 'public', 3,
   'KASSAN',
   $b$Summan är {kassan_sek} kr. Det som började som en hälsoutmaning finansierar nu en fest.$b$,
   1.0, 168, false, true, 1.0),

  ('kassan_009', 'kassan', 'public', 4,
   'ANALYS',
   $b${kassan_sek} kr. Vid nuvarande takt hinner gruppen bygga en budget värd ett styrelsemöte innan {final_date}.$b$,
   1.0, 240, false, true, 1.0),

  ('kassan_010', 'kassan', 'public', 5,
   'KASSAN: SLUTGILTIG PROGNOS',
   $b${kassan_sek} kr, {days_until_final} dagar kvar. Gruppen har kollektivt beslutat att det är enklare att betala än att gå ut. Beslutet är enhälligt och odokumenterat.$b$,
   1.0, 504, false, true, 2.0);

-- ----------------------------------------------------------------------------
-- comeback (10) — public. Streak >= 7 after a stored >= 14-day collapse.
-- No severity-5: a comeback is watched, not executed.
-- ----------------------------------------------------------------------------
insert into public.game_master_templates
  (template_key, family, visibility, severity, title_template, body_template,
   weight, cooldown_hours, once_per_subject, archive, final_weight)
values
  ('comeback_001', 'comeback', 'public', 1,
   'NOTERING',
   $b${name} är tillbaka. {streak} dagar i rad efter ett tidigare fall från {previous_streak}.$b$,
   1.0, 120, false, false, 1.0),

  ('comeback_002', 'comeback', 'public', 2,
   'SYSTEMET NOTERAR ETT ÅTERTÅG',
   $b${name} kollapsade på {previous_streak} dagar och har nu tagit sig till {streak}. Andra försöket, samma självsäkerhet.$b$,
   1.0, 120, false, true, 1.0),

  ('comeback_003', 'comeback', 'public', 2,
   'STATUS',
   $b${name} har rest sig och står på {streak} dagar. Vi låtsas alla att raset från {previous_streak} inte hände.$b$,
   1.0, 120, false, true, 1.0),

  ('comeback_004', 'comeback', 'public', 2,
   'RAPPORT',
   $b${name} är på {streak} dagar igen. Comebacken firas hårdare än den ursprungliga insatsen någonsin gjordes.$b$,
   1.0, 120, false, true, 1.0),

  ('comeback_005', 'comeback', 'public', 3,
   'ANALYS',
   $b${name} bröt {previous_streak} dagar, försvann, och dök upp igen på {streak}. Ett mönster som nu upprepats tillräckligt för att kallas ett mönster.$b$,
   1.0, 168, false, true, 1.0),

  ('comeback_006', 'comeback', 'public', 3,
   'SYSTEMET HAR SETT DET HÄR',
   $b${name} är tillbaka på {streak} dagar. Historiskt håller andra uppgången kortare än den första.$b$,
   1.0, 168, false, true, 1.0),

  ('comeback_007', 'comeback', 'public', 3,
   'LÄGESBILD',
   $b${name}: {streak} dagar efter kollapsen från {previous_streak}. Formen är återställd, garantierna är det inte.$b$,
   1.0, 168, false, true, 1.0),

  ('comeback_008', 'comeback', 'public', 3,
   'NOTERING',
   $b${name} har byggt tillbaka till {streak} dagar med {days_until_final} dagar kvar till {final_date}. Lagom tid för ytterligare ett fall.$b$,
   1.0, 168, false, true, 1.5),

  ('comeback_009', 'comeback', 'public', 4,
   'SYSTEMET MINNS BÅDA VERSIONERNA',
   $b${name} vill prata om {streak} dagar nu. Systemet vill prata om varför {previous_streak} dagar tog slut.$b$,
   1.0, 240, false, true, 1.0),

  ('comeback_010', 'comeback', 'public', 4,
   'EFTERANALYS',
   $b${name} är imponerande på väg upp och opålitlig på toppen. {streak} dagar, vi har sett filmen förr.$b$,
   1.0, 240, false, true, 1.0);

-- ----------------------------------------------------------------------------
-- ranking_position (8) — public. Current leader OR current last place only.
-- Copy is position-neutral: it reads correctly whether {rank} renders as 1 or
-- as {participant_count}. One severity-5 row, once_per_subject.
-- ----------------------------------------------------------------------------
insert into public.game_master_templates
  (template_key, family, visibility, severity, title_template, body_template,
   weight, cooldown_hours, once_per_subject, archive, final_weight)
values
  ('ranking_position_001', 'ranking_position', 'public', 1,
   'PLACERING',
   $b${name}: plats {rank} av {participant_count}. Systemet noterar läget utan kommentar.$b$,
   1.0, 120, false, false, 1.0),

  ('ranking_position_002', 'ranking_position', 'public', 2,
   'TABELLNOTERING',
   $b${name} står på plats {rank} av {participant_count} med {completed_days} avklarade dagar. Tabellen ljuger sällan.$b$,
   1.0, 120, false, true, 1.0),

  ('ranking_position_003', 'ranking_position', 'public', 2,
   'LÄGESBILD',
   $b$Plats {rank} av {participant_count} för {name}. Antingen är det något att skryta om eller något att förklara.$b$,
   1.0, 120, false, true, 1.0),

  ('ranking_position_004', 'ranking_position', 'public', 3,
   'SYSTEMET HAR RANGORDNAT',
   $b${name} hamnar på plats {rank} av {participant_count}. Siffran är inte en åsikt, den är ett resultat.$b$,
   1.0, 168, false, true, 1.0),

  ('ranking_position_005', 'ranking_position', 'public', 3,
   'TABELL',
   $b${name}, plats {rank} av {participant_count}, {completed_days} dagar avklarade. Alla andra kan också läsa tabellen.$b$,
   1.0, 168, false, true, 1.0),

  ('ranking_position_006', 'ranking_position', 'public', 3,
   'NOTERING',
   $b$Plats {rank} av {participant_count} med {days_until_final} dagar kvar till {final_date}. {name} har tid att göra siffran bättre eller värre.$b$,
   1.0, 168, false, true, 1.5),

  ('ranking_position_007', 'ranking_position', 'public', 4,
   'ANALYS',
   $b${name} befinner sig på plats {rank} av {participant_count}. Det är precis den placering insatsen hittills har förtjänat, varken mer eller mindre.$b$,
   1.0, 240, false, true, 1.0),

  ('ranking_position_008', 'ranking_position', 'public', 5,
   'SLUTGILTIG TABELLNOTERING',
   $b${name}: plats {rank} av {participant_count}, {completed_days} avklarade dagar. Systemet har sammanställt siffrorna och låter dem stå oemotsagda.$b$,
   1.0, 336, true, true, 1.0);

-- ----------------------------------------------------------------------------
-- historic_callback (10) — a due narrative memory. 8 public (the engine picks
-- 'public' for GM1 memories), 2 private spare capacity. One severity-5 row
-- (private, once_per_subject).
-- ----------------------------------------------------------------------------
insert into public.game_master_templates
  (template_key, family, visibility, severity, title_template, body_template,
   weight, cooldown_hours, once_per_subject, archive, final_weight)
values
  ('historic_callback_001', 'historic_callback', 'public', 3,
   'HISTORIK',
   $b$Förra gången {name} nådde hit tog det därefter ungefär ett dygn att återställa ordningen.$b$,
   1.0, 168, false, true, 1.0),

  ('historic_callback_002', 'historic_callback', 'public', 1,
   'ARKIVET',
   $b$Systemet har en anteckning om {name} sedan tidigare i utmaningen. Den har inte blivit mindre relevant.$b$,
   1.0, 120, false, false, 1.0),

  ('historic_callback_003', 'historic_callback', 'public', 2,
   'HISTORIK',
   $b$Vi har varit här förut med {name}. Sviten var {previous_streak} dagar då också, precis innan den inte var det.$b$,
   1.0, 120, false, true, 1.0),

  ('historic_callback_004', 'historic_callback', 'public', 2,
   'PÅMINNELSE FRÅN ARKIVET',
   $b${name} har gjort exakt det här tidigare. Systemet sparar sådant.$b$,
   1.0, 120, false, true, 1.0),

  ('historic_callback_005', 'historic_callback', 'public', 2,
   'TIDIGARE AVSNITT',
   $b$Senast {name} var i det här läget följdes det av en {previous_streak} dagar lång tystnad. Bara en notering.$b$,
   1.0, 120, false, true, 1.0),

  ('historic_callback_006', 'historic_callback', 'public', 3,
   'HISTORIK',
   $b$Arkivet noterar att {name} har stått här förr, med {days_until_final} dagar kvar till {final_date}, och att det inte slutade i en föreläsning om disciplin.$b$,
   1.0, 168, false, true, 1.5),

  ('historic_callback_007', 'historic_callback', 'public', 3,
   'SYSTEMET MINNS',
   $b${name} gör anspråk på nutiden. Arkivet vill påminna om en svit på {previous_streak} dagar som inte överlevde kontakt med en helg.$b$,
   1.0, 168, false, true, 1.0),

  ('historic_callback_008', 'historic_callback', 'public', 4,
   'MÖNSTERANALYS',
   $b$Tredje gången utmaningen registrerar det här beteendet hos {name}. Vid det här laget är det inte historia, det är biografi.$b$,
   1.0, 240, false, true, 1.0),

  ('historic_callback_009', 'historic_callback', 'private', 4,
   'PERSONLIG HISTORIK',
   $b${name}, mellan oss: du har lovat systemet det här förut. En svit på {previous_streak} dagar sa emot dig sist.$b$,
   1.0, 240, false, false, 1.0),

  ('historic_callback_010', 'historic_callback', 'private', 5,
   'ARKIVET HAR EN FULLSTÄNDIG KOPIA',
   $b${name}, arkivet minns varje svit du byggt och rivit i den här utmaningen. Den senaste var {previous_streak} dagar. Ingen av dem tog slut av sig själv.$b$,
   1.0, 336, true, false, 1.0);

-- ----------------------------------------------------------------------------
-- general_system (8) — public, NO subject. Deliberately dormant in GM1 (its
-- candidate score can never clear the 35 floor on its own). Still must be valid
-- and on-tone. Skews severity 1-2. NEVER uses {name}. All archive=false.
-- ----------------------------------------------------------------------------
insert into public.game_master_templates
  (template_key, family, visibility, severity, title_template, body_template,
   weight, cooldown_hours, once_per_subject, archive, final_weight)
values
  ('general_system_001', 'general_system', 'public', 1,
   'SYSTEMSTATUS',
   $b${participant_count} deltagare aktiva. {days_until_final} dagar kvar till {final_date}. Inget ytterligare att rapportera.$b$,
   1.0, 120, false, false, 1.0),

  ('general_system_002', 'general_system', 'public', 1,
   'NOTERING',
   $b$Systemet är vaket. Det observerar {participant_count} personer och kommenterar bara när det finns anledning.$b$,
   1.0, 120, false, false, 1.0),

  ('general_system_003', 'general_system', 'public', 1,
   'LÄGESBILD',
   $b${days_until_final} dagar återstår. Kassan står på {kassan_sek} kr. Siffrorna talar för sig själva.$b$,
   1.0, 120, false, false, 1.0),

  ('general_system_004', 'general_system', 'public', 1,
   'SYSTEMSTATUS',
   $b$Utmaningen fortgår. {participant_count} deltagare, {days_until_final} dagar kvar. Systemet återgår till att titta på.$b$,
   1.0, 120, false, false, 1.0),

  ('general_system_005', 'general_system', 'public', 2,
   'OBSERVATION',
   $b${participant_count} personer gick med frivilligt. {days_until_final} dagar kvar för var och en att förklara varför.$b$,
   1.0, 120, false, false, 1.0),

  ('general_system_006', 'general_system', 'public', 2,
   'SYSTEMET NOTERAR',
   $b$Halva insatsen i den här gruppen är träning. Andra halvan är att berätta om den. Kassan står ändå på {kassan_sek} kr.$b$,
   1.0, 120, false, false, 1.0),

  ('general_system_007', 'general_system', 'public', 2,
   'LÄGESBILD',
   $b${days_until_final} dagar till {final_date}. Systemet har sett tillräckligt många utmaningar för att veta hur den här kvartalsavslutningen brukar gå.$b$,
   1.0, 120, false, false, 1.4),

  ('general_system_008', 'general_system', 'public', 3,
   'ANALYS',
   $b${participant_count} deltagare, {kassan_sek} kr i kassan, {days_until_final} dagar kvar. Systemet drar slutsatsen att goda intentioner kostar och att gruppen redan har börjat betala.$b$,
   1.0, 168, false, false, 1.0);
