-- 0.9.1: account nascosti (per esempio "admin"). Un account nascosto può giocare normalmente, ma gli altri non lo
-- vedono: non compare tra i giocatori, gli amici, gli inviti, il profilo pubblico, il feed e le classifiche.
ALTER TABLE users ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
UPDATE users SET hidden = 1 WHERE username_lc = 'admin';
-- via dagli amici di tutti (anche richieste in attesa)
DELETE FROM friendships WHERE user_a IN (SELECT id FROM users WHERE hidden = 1) OR user_b IN (SELECT id FROM users WHERE hidden = 1);
-- via dalle competizioni tra amici: le sue le eliminiamo, nelle altre la sua squadra passa all'IA
UPDATE friend_comps SET status = 'CANCELLED' WHERE owner_id IN (SELECT id FROM users WHERE hidden = 1);
DELETE FROM friend_comp_reports WHERE user_id IN (SELECT id FROM users WHERE hidden = 1);
DELETE FROM friend_comp_rooms WHERE host_id IN (SELECT id FROM users WHERE hidden = 1);
DELETE FROM friend_comp_members WHERE user_id IN (SELECT id FROM users WHERE hidden = 1);
